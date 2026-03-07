import { useEffect, useState, type FormEvent } from 'react'
import type {
  AdminOverview,
  FederationDeliveryJob,
  FederationPeer,
  TurnCredentials
} from '../lib/api'
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
} from '../lib/api'
import { useAppContext } from '../contexts/AppContext'

export type UseFederationParams = {
  view: string
}

export function useFederation(params: UseFederationParams) {
  const { storedDevice, setBanner, setLoading } = useAppContext()
  const { view } = params

  const [federationPeers, setFederationPeers] = useState<FederationPeer[]>([])
  const [federationDeliveries, setFederationDeliveries] = useState<FederationDeliveryJob[]>([])
  const [federationDomain, setFederationDomain] = useState('')
  const [federationDisplayName, setFederationDisplayName] = useState('')
  const [federationInviteToken, setFederationInviteToken] = useState<string | null>(null)
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null)
  const [turnCredentials, setTurnCredentials] = useState<TurnCredentials | null>(null)

  // Admin overview / federation data load
  useEffect(() => {
    if (!storedDevice || view !== 'chat') {
      setAdminOverview(null)
      setFederationPeers([])
      setFederationDeliveries([])
      setTurnCredentials(null)
      return
    }

    const sessionToken = storedDevice.sessionToken
    let cancelled = false

    async function loadOpsSurface() {
      try {
        const [overviewResponse, peersResponse, deliveriesResponse, turnResponse] = await Promise.all([
          fetchAdminOverview(sessionToken),
          listFederationPeers(sessionToken),
          listFederationDeliveries(sessionToken),
          fetchTurnCredentials(sessionToken, { ttl_seconds: 600 })
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
  }, [storedDevice, view])

  async function handleCreateFederationPeer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!storedDevice || federationDomain.trim() === '') {
      return
    }

    setLoading(true)

    try {
      const response = await createFederationPeer(storedDevice.sessionToken, {
        domain: federationDomain.trim(),
        display_name: federationDisplayName.trim() || undefined
      })

      setFederationPeers((current) => [response.peer, ...current.filter((peer) => peer.id !== response.peer.id)])
      setFederationDomain('')
      setFederationDisplayName('')
      setBanner({ tone: 'success', message: `Federation peer queued: ${response.peer.domain}` })

      const overviewResponse = await fetchAdminOverview(storedDevice.sessionToken)
      setAdminOverview(overviewResponse.overview)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create federation peer.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleQueueFederationDelivery(peerId: string) {
    if (!storedDevice) {
      return
    }

    setLoading(true)

    try {
      const response = await createFederationDelivery(storedDevice.sessionToken, peerId, {
        event_type: 'message_relay',
        payload: { source: 'operator_ui' }
      })

      setFederationDeliveries((current) => [response.delivery, ...current.filter((job) => job.id !== response.delivery.id)])

      const overviewResponse = await fetchAdminOverview(storedDevice.sessionToken)
      setAdminOverview(overviewResponse.overview)
      setBanner({ tone: 'success', message: 'Federation delivery queued.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to queue the federation delivery.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateFederationPeerInvite(peerId: string) {
    if (!storedDevice) {
      return
    }

    setLoading(true)

    try {
      const response = await createFederationPeerInvite(storedDevice.sessionToken, peerId)
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

  async function handleAttemptFederationDelivery(jobId: string) {
    if (!storedDevice) {
      return
    }

    setLoading(true)

    try {
      const response = await attemptFederationDelivery(storedDevice.sessionToken, jobId, {
        outcome: 'delivered'
      })

      setFederationDeliveries((current) =>
        current.map((job) => (job.id === response.delivery.id ? response.delivery : job))
      )

      const overviewResponse = await fetchAdminOverview(storedDevice.sessionToken)
      setAdminOverview(overviewResponse.overview)
      setBanner({ tone: 'success', message: `Delivery ${response.delivery.status}.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to advance the delivery job.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdateFederationPeerStatus(
    peerId: string,
    status: 'pending' | 'active' | 'disabled'
  ) {
    if (!storedDevice) {
      return
    }

    const sessionToken = storedDevice.sessionToken
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

  async function handleHeartbeatFederationPeer(peerId: string) {
    if (!storedDevice) {
      return
    }

    const sessionToken = storedDevice.sessionToken
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

  async function handleRefreshTurnCredentials() {
    if (!storedDevice) {
      return
    }

    setLoading(true)

    try {
      const response = await fetchTurnCredentials(storedDevice.sessionToken, { ttl_seconds: 900 })
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
    federationPeers,
    federationDeliveries,
    federationDomain,
    setFederationDomain,
    federationDisplayName,
    setFederationDisplayName,
    federationInviteToken,
    adminOverview,
    turnCredentials,
    handleCreateFederationPeer,
    handleQueueFederationDelivery,
    handleCreateFederationPeerInvite,
    handleAttemptFederationDelivery,
    handleUpdateFederationPeerStatus,
    handleHeartbeatFederationPeer,
    handleRefreshTurnCredentials
  }
}
