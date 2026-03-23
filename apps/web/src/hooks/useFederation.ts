import { useState, useEffect, type FormEvent } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type {
  AdminOverview,
  FederationDeliveryJob,
  FederationPeer,
  TurnCredentials
} from '../lib/api.ts'
import {
  attemptFederationDelivery,
  createFederationDelivery,
  createFederationPeer,
  createFederationPeerInvite,
  fetchAdminOverview,
  fetchTurnCredentials,
  listFederationDeliveries,
  listFederationPeers,
  recordFederationPeerHeartbeat,
  updateFederationPeerStatus
} from '../lib/api.ts'
import type { AuthView } from '../types.ts'

export function useFederation(view: AuthView) {
  const { sessionToken, storedDevice, loading, setLoading, setBanner } = useAppContext()
  const [_adminOverview, setAdminOverview] = useState<AdminOverview | null>(null)
  const [_federationPeers, setFederationPeers] = useState<FederationPeer[]>([])
  const [_federationDeliveries, setFederationDeliveries] = useState<FederationDeliveryJob[]>([])
  const [federationDomain, setFederationDomain] = useState('')
  const [federationDisplayName, setFederationDisplayName] = useState('')
  const [_federationInviteToken, setFederationInviteToken] = useState<string | null>(null)
  const [_turnCredentials, setTurnCredentials] = useState<TurnCredentials | null>(null)

  useEffect(() => {
    if (!sessionToken || view !== 'chat') {
      setAdminOverview(null)
      setFederationPeers([])
      setFederationDeliveries([])
      setTurnCredentials(null)
      return
    }

    const token = sessionToken
    let cancelled = false

    async function loadOpsSurface() {
      try {
        const [overviewResponse, peersResponse, deliveriesResponse, turnResponse] = await Promise.all([
          fetchAdminOverview(token),
          listFederationPeers(token),
          listFederationDeliveries(token),
          fetchTurnCredentials(token, { ttl_seconds: 600 })
        ])

        if (cancelled) {
          return
        }

        setAdminOverview(overviewResponse.overview)
        setFederationPeers(peersResponse.peers)
        setFederationDeliveries(deliveriesResponse.deliveries)
        setTurnCredentials(turnResponse.turn)
      } catch {
        if (!cancelled) {
          setAdminOverview(null)
          setFederationPeers([])
          setFederationDeliveries([])
          setTurnCredentials(null)
        }
      }
    }

    void loadOpsSurface()

    return () => {
      cancelled = true
    }
  }, [sessionToken, view])

  async function _handleCreateFederationPeer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!sessionToken || federationDomain.trim() === '') {
      return
    }

    setLoading(true)

    try {
      const response = await createFederationPeer(sessionToken, {
        domain: federationDomain.trim(),
        display_name: federationDisplayName.trim() || undefined
      })

      setFederationPeers((current) => [response.peer, ...current.filter((peer) => peer.id !== response.peer.id)])
      setFederationDomain('')
      setFederationDisplayName('')
      setBanner({ tone: 'success', message: `Federation peer queued: ${response.peer.domain}` })

      const overviewResponse = await fetchAdminOverview(sessionToken)
      setAdminOverview(overviewResponse.overview)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create federation peer.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleQueueFederationDelivery(peerId: string) {
    if (!sessionToken) {
      return
    }

    setLoading(true)

    try {
      const response = await createFederationDelivery(sessionToken, peerId, {
        event_type: 'message_relay',
        payload: { source: 'operator_ui' }
      })

      setFederationDeliveries((current) => [response.delivery, ...current.filter((job) => job.id !== response.delivery.id)])

      const overviewResponse = await fetchAdminOverview(sessionToken)
      setAdminOverview(overviewResponse.overview)
      setBanner({ tone: 'success', message: 'Federation delivery queued.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to queue the federation delivery.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleCreateFederationPeerInvite(peerId: string) {
    if (!sessionToken) {
      return
    }

    setLoading(true)

    try {
      const response = await createFederationPeerInvite(sessionToken, peerId)
      setFederationPeers((current) =>
        current.map((peer) => (peer.id === response.peer.id ? response.peer : peer))
      )
      setFederationInviteToken(response.invite_token)
      setBanner({
        tone: 'success',
        message: `Invite token issued for ${response.peer.domain}. Share it with the remote operator to complete trust.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to issue federation invite.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleAttemptFederationDelivery(jobId: string) {
    if (!sessionToken) {
      return
    }

    setLoading(true)

    try {
      const response = await attemptFederationDelivery(sessionToken, jobId, {
        outcome: 'delivered'
      })

      setFederationDeliveries((current) =>
        current.map((job) => (job.id === response.delivery.id ? response.delivery : job))
      )

      const overviewResponse = await fetchAdminOverview(sessionToken)
      setAdminOverview(overviewResponse.overview)
      setBanner({ tone: 'success', message: `Delivery ${response.delivery.status}.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to advance the delivery job.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleUpdateFederationPeerStatus(
    peerId: string,
    status: 'pending' | 'active' | 'disabled'
  ) {
    if (!sessionToken) {
      return
    }

    setLoading(true)

    try {
      const response = await updateFederationPeerStatus(sessionToken, peerId, status)
      setFederationPeers((current) =>
        current.map((peer) => (peer.id === response.peer.id ? response.peer : peer))
      )
      setBanner({ tone: 'success', message: `Federation peer ${response.peer.domain} is now ${status}.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update federation peer.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleHeartbeatFederationPeer(peerId: string) {
    if (!sessionToken) {
      return
    }

    setLoading(true)

    try {
      const response = await recordFederationPeerHeartbeat(sessionToken, peerId)
      setFederationPeers((current) =>
        current.map((peer) => (peer.id === response.peer.id ? response.peer : peer))
      )
      setBanner({ tone: 'success', message: `Heartbeat recorded for ${response.peer.domain}.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record federation peer heartbeat.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleRefreshTurnCredentials() {
    if (!sessionToken) {
      return
    }

    setLoading(true)

    try {
      const response = await fetchTurnCredentials(sessionToken, { ttl_seconds: 900 })
      setTurnCredentials(response.turn)
      setBanner({ tone: 'success', message: 'TURN credentials refreshed for call setup.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh TURN credentials.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  return {
    federationDomain,
    setFederationDomain,
    federationDisplayName,
    setFederationDisplayName,
    setAdminOverview,
    setFederationPeers,
    setTurnCredentials,
    _handleCreateFederationPeer,
    _handleQueueFederationDelivery,
    _handleCreateFederationPeerInvite,
    _handleAttemptFederationDelivery,
    _handleUpdateFederationPeerStatus,
    _handleHeartbeatFederationPeer,
    _handleRefreshTurnCredentials
  }
}
