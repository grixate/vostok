import { useState, useEffect, useRef, useEffectEvent } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type {
  CallKeyDistribution,
  CallParticipant,
  CallRoomState,
  CallSession,
  CallSignal,
  CallWebRtcEndpointState
} from '../lib/api.ts'
import {
  createCallSession,
  endCallSession,
  fetchActiveCall,
  fetchCallKeys,
  fetchCallState,
  fetchCallWebRtcEndpointState,
  joinCallSession,
  leaveCallSession,
  listRecipientDevices,
  pollCallWebRtcMediaEvents,
  provisionCallWebRtcEndpoint,
  pushCallWebRtcMediaEvent,
  rotateCallKeys
} from '../lib/api.ts'
import {
  attachLocalTracksToMembrane,
  cleanupMembraneClient,
  connectMembraneClient,
  createMembraneClient,
  receiveMembraneMediaEvent,
  removeLocalTracksFromMembrane,
  updateMembraneEndpointMetadata,
  type MembraneClient,
  type MembraneRemoteEndpointSnapshot,
  type MembraneRemoteTrackSnapshot
} from '../lib/membrane-native.ts'
import { wrapGroupSenderKeyForRecipients } from '../lib/message-vault.ts'
import { bytesToBase64 } from '../lib/base64.ts'
import { subscribeToCallStream } from '../lib/realtime.ts'
import { mergeCallSignals, readMembraneNativeEventType } from '../utils/call-helpers.ts'
import type { AuthView } from '../types.ts'

export function useCall(
  view: AuthView,
  deferredActiveChatId: string | null,
  activeChatId: string | null
) {
  const { storedDevice, loading, setLoading, setBanner } = useAppContext()
  const [activeCall, setActiveCall] = useState<CallSession | null>(null)
  const [_callParticipants, setCallParticipants] = useState<CallParticipant[]>([])
  const [callKeys, setCallKeys] = useState<CallKeyDistribution[]>([])
  const [_callRoom, setCallRoom] = useState<CallRoomState | null>(null)
  const [callWebRtcEndpoint, setCallWebRtcEndpoint] = useState<CallWebRtcEndpointState | null>(null)
  const [_callWebRtcMediaEvents, setCallWebRtcMediaEvents] = useState<string[]>([])
  const [callSignals, setCallSignals] = useState<CallSignal[]>([])
  const [_localMediaMode, setLocalMediaMode] = useState<'none' | 'audio' | 'audio_video'>('none')
  const [localAudioTrackCount, setLocalAudioTrackCount] = useState(0)
  const [localVideoTrackCount, setLocalVideoTrackCount] = useState(0)
  const [_membraneClientReady, setMembraneClientReady] = useState(false)
  const [membraneClientConnected, setMembraneClientConnected] = useState(false)
  const [_membraneRemoteEndpointCount, setMembraneRemoteEndpointCount] = useState(0)
  const [_membraneRemoteTrackCount, setMembraneRemoteTrackCount] = useState(0)
  const [_membraneReadyTrackCount, setMembraneReadyTrackCount] = useState(0)
  const [_membraneReadyAudioTrackCount, setMembraneReadyAudioTrackCount] = useState(0)
  const [_membraneReadyVideoTrackCount, setMembraneReadyVideoTrackCount] = useState(0)
  const [_membraneRemoteEndpointIds, setMembraneRemoteEndpointIds] = useState<string[]>([])
  const [_membraneRemoteTrackIds, setMembraneRemoteTrackIds] = useState<string[]>([])
  const [membraneRemoteEndpoints, setMembraneRemoteEndpoints] = useState<MembraneRemoteEndpointSnapshot[]>([])
  const [membraneRemoteTracks, setMembraneRemoteTracks] = useState<MembraneRemoteTrackSnapshot[]>([])
  const [_membraneClientEndpointId, setMembraneClientEndpointId] = useState<string | null>(null)

  const callSignalsRef = useRef<CallSignal[]>([])
  const membraneClientRef = useRef<MembraneClient | null>(null)
  const membraneClientCallIdRef = useRef<string | null>(null)
  const membraneLocalTrackIdsRef = useRef<string[]>([])
  const localMediaStreamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    callSignalsRef.current = callSignals
  }, [callSignals])

  function resetMembraneClient() {
    void removeLocalTracksFromMembrane(membraneClientRef.current, membraneLocalTrackIdsRef.current)
    cleanupMembraneClient(membraneClientRef.current)
    membraneClientRef.current = null
    membraneClientCallIdRef.current = null
    membraneLocalTrackIdsRef.current = []
    setMembraneClientReady(false)
    setMembraneClientConnected(false)
    setMembraneRemoteEndpointCount(0)
    setMembraneRemoteTrackCount(0)
    setMembraneReadyTrackCount(0)
    setMembraneReadyAudioTrackCount(0)
    setMembraneReadyVideoTrackCount(0)
    setMembraneRemoteEndpointIds([])
    setMembraneRemoteTrackIds([])
    setMembraneRemoteEndpoints([])
    setMembraneRemoteTracks([])
    setMembraneClientEndpointId(null)
  }

  function resetWebRtcLab() {
    resetMembraneClient()

    if (localMediaStreamRef.current) {
      for (const track of localMediaStreamRef.current.getTracks()) {
        track.stop()
      }
    }

    localMediaStreamRef.current = null
    setLocalMediaMode('none')
    setLocalAudioTrackCount(0)
    setLocalVideoTrackCount(0)
  }

  function ensureMembraneClient(): MembraneClient {
    const activeCallId = activeCall?.id ?? null

    if (!activeCallId || !storedDevice) {
      throw new Error('No active call is available for Membrane client bootstrap.')
    }

    if (membraneClientRef.current && membraneClientCallIdRef.current === activeCallId) {
      return membraneClientRef.current
    }

    if (membraneClientRef.current) {
      resetMembraneClient()
    }

    const sessionToken = storedDevice.sessionToken
    const deviceId = storedDevice.deviceId
    const client = createMembraneClient({
      onSendMediaEvent(mediaEvent) {
        void pushCallWebRtcMediaEvent(sessionToken, activeCallId, mediaEvent)
          .then((response) => {
            setCallWebRtcEndpoint(response.endpoint)
          })
          .catch(() => undefined)
      },
      onConnected(payload) {
        setMembraneClientConnected(true)
        setMembraneClientEndpointId(payload.endpointId)
        setMembraneRemoteEndpointCount(payload.otherEndpointCount)
      },
      onDisconnected() {
        setMembraneClientConnected(false)
        setMembraneRemoteEndpointCount(0)
        setMembraneRemoteTrackCount(0)
        setMembraneReadyTrackCount(0)
        setMembraneReadyAudioTrackCount(0)
        setMembraneReadyVideoTrackCount(0)
        setMembraneRemoteEndpointIds([])
        setMembraneRemoteTrackIds([])
        setMembraneRemoteEndpoints([])
        setMembraneRemoteTracks([])
      },
      onRemoteStateChange(payload) {
        setMembraneRemoteEndpointCount(payload.endpointCount)
        setMembraneRemoteTrackCount(payload.trackCount)
        setMembraneReadyTrackCount(payload.readyTrackCount)
        setMembraneReadyAudioTrackCount(payload.readyAudioTrackCount)
        setMembraneReadyVideoTrackCount(payload.readyVideoTrackCount)
        setMembraneRemoteEndpointIds(payload.endpointIds)
        setMembraneRemoteTrackIds(payload.trackIds)
        setMembraneRemoteEndpoints(payload.endpoints)
        setMembraneRemoteTracks(payload.tracks)
      },
      onConnectionError(message) {
        setBanner({
          tone: 'error',
          message: `Membrane WebRTC client error: ${message}`
        })
      }
    })

    membraneClientRef.current = client
    membraneClientCallIdRef.current = activeCallId
    membraneLocalTrackIdsRef.current = []
    setMembraneClientReady(true)
    setMembraneClientConnected(false)
    setMembraneRemoteEndpointCount(0)
    setMembraneRemoteTrackCount(0)
    setMembraneReadyTrackCount(0)
    setMembraneReadyAudioTrackCount(0)
    setMembraneReadyVideoTrackCount(0)
    setMembraneRemoteEndpointIds([])
    setMembraneRemoteTrackIds([])
    setMembraneRemoteEndpoints([])
    setMembraneRemoteTracks([])
    setMembraneClientEndpointId(deviceId)

    return client
  }

  const handleRealtimeCallState = useEffectEvent((call: CallSession | null) => {
    if (!call || call.status !== 'active') {
      setActiveCall(null)
      setCallParticipants([])
      setCallRoom(null)
      setCallWebRtcEndpoint(null)
      setCallWebRtcMediaEvents([])
      callSignalsRef.current = []
      setCallSignals([])
      return
    }

    setActiveCall(call)
  })

  const handleRealtimeCallParticipants = useEffectEvent(
    (payload: { callId: string; participants: CallParticipant[]; room: CallRoomState | null }) => {
      if (!activeCall || payload.callId !== activeCall.id) {
        return
      }

      setCallParticipants(payload.participants)
      setCallRoom(payload.room)
    }
  )

  const handleRealtimeCallSignal = useEffectEvent(
    (payload: { callId: string; signal: CallSignal }) => {
      if (!activeCall || payload.callId !== activeCall.id) {
        return
      }

      const nextSignals = mergeCallSignals(callSignalsRef.current, payload.signal)
      callSignalsRef.current = nextSignals
      setCallSignals(nextSignals)
    }
  )

  const handleRealtimeCallSubscriptionError = useEffectEvent(() => {
    setBanner({
      tone: 'error',
      message: 'Realtime call subscription failed. Manual call refresh is still available.'
    })
  })

  const handleMembraneQueueBatch = useEffectEvent((events: string[]) => {
    if (events.length === 0) {
      return
    }

    setCallWebRtcMediaEvents((current) => [...events.reverse(), ...current].slice(0, 8))

    const nativeEvents = events.filter((eventPayload) => readMembraneNativeEventType(eventPayload) !== null)

    if (nativeEvents.length > 0 && membraneClientRef.current) {
      for (const eventPayload of nativeEvents) {
        try {
          receiveMembraneMediaEvent(membraneClientRef.current, eventPayload)
        } catch {
          // Ignore malformed native events and keep the queue processing alive.
        }
      }
    }
  })

  // Load active call on chat change
  useEffect(() => {
    if (!storedDevice || !deferredActiveChatId || view !== 'chat') {
      setActiveCall(null)
      setCallParticipants([])
      setCallKeys([])
      setCallRoom(null)
      setCallWebRtcEndpoint(null)
      setCallWebRtcMediaEvents([])
      callSignalsRef.current = []
      setCallSignals([])
      resetWebRtcLab()
      return
    }

    const chatId = deferredActiveChatId
    const sessionToken = storedDevice.sessionToken
    let cancelled = false

    async function loadActiveCall() {
      try {
        const response = await fetchActiveCall(sessionToken, chatId)

        if (!cancelled) {
          setActiveCall(response.call)
        }
      } catch {
        if (!cancelled) {
          setActiveCall(null)
        }
      }
    }

    void loadActiveCall()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredActiveChatId, storedDevice, view])

  // Load call state when active call changes
  useEffect(() => {
    if (!storedDevice || !activeCall || view !== 'chat') {
      setCallParticipants([])
      setCallKeys([])
      setCallRoom(null)
      setCallWebRtcEndpoint(null)
      setCallWebRtcMediaEvents([])
      callSignalsRef.current = []
      setCallSignals([])
      resetWebRtcLab()
      return
    }

    const sessionToken = storedDevice.sessionToken
    const callId = activeCall.id
    let cancelled = false
    setCallWebRtcMediaEvents([])

    async function loadCallState() {
      try {
        const response = await fetchCallState(sessionToken, callId)

        if (!cancelled) {
          setCallParticipants(response.participants)
          callSignalsRef.current = response.signals
          setCallSignals(response.signals)
          setCallRoom(response.room)
          const callKeysResponse = await fetchCallKeys(sessionToken, callId)
          if (!cancelled) {
            setCallKeys(callKeysResponse.keys)
          }
          const endpointResponse = await fetchCallWebRtcEndpointState(sessionToken, callId)

          if (!cancelled) {
            setCallWebRtcEndpoint(endpointResponse.endpoint)
            setCallRoom(endpointResponse.room ?? response.room)
          }
        }
      } catch {
        if (!cancelled) {
          setCallParticipants([])
          setCallKeys([])
          setCallRoom(null)
          setCallWebRtcEndpoint(null)
          setCallWebRtcMediaEvents([])
          callSignalsRef.current = []
          setCallSignals([])
        }
      }
    }

    void loadCallState()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall, storedDevice, view])

  // Poll Membrane WebRTC endpoint
  useEffect(() => {
    if (!storedDevice || !activeCall || view !== 'chat' || !callWebRtcEndpoint?.exists) {
      return
    }

    const sessionToken = storedDevice.sessionToken
    const callId = activeCall.id
    let cancelled = false
    let inFlight = false

    async function syncMembraneWebRtcQueue() {
      if (cancelled || inFlight) {
        return
      }

      inFlight = true

      try {
        const response = await pollCallWebRtcMediaEvents(sessionToken, callId)

        if (!cancelled) {
          setCallWebRtcEndpoint(response.endpoint)
          handleMembraneQueueBatch(response.media_events)
        }
      } catch {
        // Ignore transient poll errors and continue interval polling.
      } finally {
        inFlight = false
      }
    }

    void syncMembraneWebRtcQueue()
    const intervalId = window.setInterval(() => void syncMembraneWebRtcQueue(), 3_000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeCall, callWebRtcEndpoint?.exists, storedDevice, view])

  // Attach local tracks to Membrane
  useEffect(() => {
    if (
      !activeCall ||
      !storedDevice ||
      view !== 'chat' ||
      !membraneClientConnected ||
      !membraneClientRef.current ||
      !localMediaStreamRef.current
    ) {
      return
    }

    if (membraneLocalTrackIdsRef.current.length > 0) {
      return
    }

    const membraneClient = membraneClientRef.current
    const localStream = localMediaStreamRef.current
    let cancelled = false

    async function syncTracks() {
      try {
        const trackIds = await attachLocalTracksToMembrane(membraneClient, localStream)

        if (!cancelled) {
          membraneLocalTrackIdsRef.current = trackIds
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to attach local tracks to the Membrane client.'
          setBanner({ tone: 'error', message })
        }
      }
    }

    void syncTracks()

    return () => {
      cancelled = true
    }
  }, [activeCall, localAudioTrackCount, localVideoTrackCount, membraneClientConnected, storedDevice, view])

  // Subscribe to call stream
  useEffect(() => {
    if (!storedDevice || !deferredActiveChatId || view !== 'chat') {
      return
    }

    const chatId = deferredActiveChatId

    return subscribeToCallStream(storedDevice.sessionToken, chatId, {
      onState(call) {
        handleRealtimeCallState(call)
      },
      onParticipants(payload) {
        handleRealtimeCallParticipants(payload)
      },
      onSignal(payload) {
        handleRealtimeCallSignal(payload)
      },
      onError: handleRealtimeCallSubscriptionError
    })
  }, [deferredActiveChatId, storedDevice, view])

  async function handleStartCall(mode: 'voice' | 'video' | 'group') {
    if (!storedDevice || !activeChatId) {
      return
    }

    const sessionToken = storedDevice.sessionToken
    setLoading(true)

    try {
      const response = await createCallSession(sessionToken, activeChatId, { mode })
      setActiveCall(response.call)
      setBanner({ tone: 'success', message: `${mode} call session is now active.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start call.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleEndCall() {
    if (!storedDevice || !activeCall) {
      return
    }

    const sessionToken = storedDevice.sessionToken
    setLoading(true)

    try {
      const response = await endCallSession(sessionToken, activeCall.id)
      setActiveCall(response.call.status === 'active' ? response.call : null)
      setBanner({ tone: 'success', message: 'Call session ended.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to end call.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleJoinActiveCall() {
    if (!storedDevice || !activeCall) {
      return
    }

    const latestCallKey =
      activeCall.mode === 'group'
        ? [...callKeys].sort((left, right) => right.key_epoch - left.key_epoch)[0] ?? null
        : null

    if (activeCall.mode === 'group' && !latestCallKey) {
      setBanner({
        tone: 'error',
        message:
          'Group call join is blocked until a call key epoch is distributed. Rotate call keys first.'
      })
      return
    }

    const sessionToken = storedDevice.sessionToken
    const trackKind = activeCall.mode === 'voice' ? 'audio' : 'audio_video'
    setLoading(true)

    try {
      const joinPayload: {
        track_kind: 'audio' | 'video' | 'audio_video'
        e2ee_capable?: boolean
        e2ee_algorithm?: string
        e2ee_key_epoch?: number
      } = {
        track_kind: trackKind
      }

      if (activeCall.mode === 'group' && latestCallKey) {
        joinPayload.e2ee_capable = true
        joinPayload.e2ee_algorithm = latestCallKey.algorithm
        joinPayload.e2ee_key_epoch = latestCallKey.key_epoch
      }

      const response = await joinCallSession(sessionToken, activeCall.id, joinPayload)
      setCallParticipants(response.participants)
      setCallRoom(response.room)
      const endpointResponse = await fetchCallWebRtcEndpointState(sessionToken, activeCall.id)
      setCallWebRtcEndpoint(endpointResponse.endpoint)
      setCallRoom(endpointResponse.room ?? response.room)
      setBanner({
        tone: 'success',
        message: `Joined the Membrane room as ${trackKind.replace('_', '+')} and the device endpoint is ready.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to join the active call.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleRotateCallKeyEpoch() {
    if (!storedDevice || !activeCall || !activeChatId) {
      return
    }

    setLoading(true)

    try {
      const recipientDeviceResponse = await listRecipientDevices(storedDevice.sessionToken, activeChatId)

      const targetRecipients = recipientDeviceResponse.recipient_devices.filter(
        (device) => device.device_id !== storedDevice.deviceId
      )

      if (targetRecipients.length === 0) {
        throw new Error('No active recipient devices are available for call key rotation.')
      }

      const keyMaterial = bytesToBase64(window.crypto.getRandomValues(new Uint8Array(32)))
      const wrappedKeys = await wrapGroupSenderKeyForRecipients(keyMaterial, targetRecipients)
      const nextEpoch = Math.max(0, ...callKeys.map((key) => key.key_epoch)) + 1

      const response = await rotateCallKeys(storedDevice.sessionToken, activeCall.id, {
        key_epoch: nextEpoch,
        algorithm: 'sframe-aes-gcm-v1',
        wrapped_keys: wrappedKeys
      })

      setCallKeys(response.keys)
      setBanner({
        tone: 'success',
        message: `Call key epoch ${nextEpoch} rotated for ${response.keys.length} participant device${response.keys.length === 1 ? '' : 's'}.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rotate call key epoch.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleLeaveActiveCall() {
    if (!storedDevice || !activeCall) {
      return
    }

    const sessionToken = storedDevice.sessionToken
    setLoading(true)

    try {
      const response = await leaveCallSession(sessionToken, activeCall.id)
      setCallParticipants(response.participants)
      setCallRoom(response.room)
      const endpointResponse = await fetchCallWebRtcEndpointState(sessionToken, activeCall.id)
      setCallWebRtcEndpoint(endpointResponse.endpoint)
      setCallWebRtcMediaEvents([])
      setBanner({ tone: 'success', message: 'Left the active Membrane room.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to leave the active call.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleProvisionMembraneWebRtcEndpoint() {
    if (!storedDevice || !activeCall) {
      return
    }

    setLoading(true)

    try {
      const response = await provisionCallWebRtcEndpoint(storedDevice.sessionToken, activeCall.id)
      setCallWebRtcEndpoint(response.endpoint)
      setCallRoom(response.room)
      setBanner({
        tone: 'success',
        message: `Membrane WebRTC endpoint ready for ${response.endpoint.endpoint_id}.`
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to provision the Membrane WebRTC endpoint.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handlePollMembraneWebRtcEndpoint() {
    if (!storedDevice || !activeCall) {
      return
    }

    setLoading(true)

    try {
      const response = await pollCallWebRtcMediaEvents(storedDevice.sessionToken, activeCall.id)
      setCallWebRtcEndpoint(response.endpoint)
      setCallWebRtcMediaEvents((current) =>
        [...response.media_events.reverse(), ...current].slice(0, 8)
      )

      const nativeEventCount = response.media_events.reduce((count, eventPayload) => {
        return readMembraneNativeEventType(eventPayload) === null ? count : count + 1
      }, 0)

      setBanner({
        tone: 'success',
        message:
          response.media_events.length > 0
            ? nativeEventCount > 0
              ? `Polled ${response.media_events.length} outbound Membrane media event${response.media_events.length === 1 ? '' : 's'}, including ${nativeEventCount} native protocol event${nativeEventCount === 1 ? '' : 's'}.`
              : `Polled ${response.media_events.length} outbound Membrane media event${response.media_events.length === 1 ? '' : 's'}.`
            : 'Membrane WebRTC endpoint has no queued outbound media events.'
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to poll the Membrane WebRTC endpoint.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handlePingMembraneWebRtcEndpoint() {
    if (!storedDevice || !activeCall) {
      return
    }

    setLoading(true)

    try {
      const client = membraneClientRef.current

      if (!client) {
        throw new Error('Initialize WebRTC + Membrane before sending native endpoint updates.')
      }

      updateMembraneEndpointMetadata(client, {
        pinged_at: new Date().toISOString(),
        source: 'web-client',
        mode: activeCall.mode
      })
      setBanner({
        tone: 'success',
        message: 'Endpoint metadata update sent through the Membrane WebRTC client.'
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update Membrane endpoint metadata.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleInitializeWebRtc() {
    if (!activeCall || !storedDevice) {
      return
    }

    setLoading(true)

    try {
      const sessionToken = storedDevice.sessionToken
      const endpointResponse = await provisionCallWebRtcEndpoint(sessionToken, activeCall.id)
      const client = ensureMembraneClient()
      if (!membraneClientConnected) {
        connectMembraneClient(client, {
          call_id: activeCall.id,
          device_id: storedDevice.deviceId,
          mode: activeCall.mode,
          source: 'web-client',
          username: storedDevice.username
        })
      }
      setCallWebRtcEndpoint(endpointResponse.endpoint)
      setCallRoom(endpointResponse.room)
      setBanner({
        tone: 'success',
        message:
          'Native Membrane WebRTC client initialized and connected to the provisioned endpoint.'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize native WebRTC.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleAttachLocalMedia(mode: 'audio' | 'audio_video') {
    if (!activeCall) {
      return
    }

    setLoading(true)

    try {
      const stream = await window.navigator.mediaDevices.getUserMedia(
        mode === 'audio'
          ? { audio: true, video: false }
          : {
              audio: true,
              video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
              }
            }
      )

      if (localMediaStreamRef.current) {
        for (const track of localMediaStreamRef.current.getTracks()) {
          track.stop()
        }
      }

      localMediaStreamRef.current = stream

      if (membraneClientRef.current && membraneClientConnected) {
        await removeLocalTracksFromMembrane(
          membraneClientRef.current,
          membraneLocalTrackIdsRef.current
        )
        membraneLocalTrackIdsRef.current = []
        membraneLocalTrackIdsRef.current = await attachLocalTracksToMembrane(
          membraneClientRef.current,
          stream
        )
      }

      setLocalMediaMode(mode)
      setLocalAudioTrackCount(stream.getAudioTracks().length)
      setLocalVideoTrackCount(stream.getVideoTracks().length)
      setBanner({
        tone: 'success',
        message:
          mode === 'audio'
            ? 'Microphone attached to the native Membrane pipeline.'
            : 'Camera and microphone attached to the native Membrane pipeline.'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to attach local media.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleReleaseLocalMedia() {
    await removeLocalTracksFromMembrane(membraneClientRef.current, membraneLocalTrackIdsRef.current)
    membraneLocalTrackIdsRef.current = []

    if (localMediaStreamRef.current) {
      for (const track of localMediaStreamRef.current.getTracks()) {
        track.stop()
      }
    }

    localMediaStreamRef.current = null
    setLocalMediaMode('none')
    setLocalAudioTrackCount(0)
    setLocalVideoTrackCount(0)
    setBanner({
      tone: 'success',
      message: 'Local microphone/camera tracks were removed from the native Membrane pipeline.'
    })
  }

  function resetCallState() {
    setActiveCall(null)
    setCallParticipants([])
    setCallRoom(null)
    setCallWebRtcEndpoint(null)
    setCallWebRtcMediaEvents([])
    callSignalsRef.current = []
    setCallSignals([])
    resetWebRtcLab()
  }

  return {
    activeCall,
    setActiveCall,
    callSignals,
    membraneRemoteEndpoints,
    membraneRemoteTracks,
    handleStartCall,
    handleEndCall,
    _handleJoinActiveCall,
    _handleRotateCallKeyEpoch,
    _handleLeaveActiveCall,
    _handleProvisionMembraneWebRtcEndpoint,
    _handlePollMembraneWebRtcEndpoint,
    _handlePingMembraneWebRtcEndpoint,
    _handleInitializeWebRtc,
    _handleAttachLocalMedia,
    _handleReleaseLocalMedia,
    resetCallState,
    resetWebRtcLab,
    setCallParticipants,
    setCallRoom,
    setCallWebRtcEndpoint,
    setCallWebRtcMediaEvents
  }
}
