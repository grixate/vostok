import { useState, useEffect, useRef, useEffectEvent, useMemo, useCallback } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type {
  CallKeyDistribution,
  CallParticipant,
  CallRoom,
  CallRoomMember,
  CallRoomState,
  CallScope,
  CallSession,
  CallSignal,
  TurnCredentials,
  CallWebRtcEndpointState
} from '../lib/api.ts'
import {
  acceptCallSession,
  createCallRoom,
  createCallRoomSession,
  createCallSession,
  declineCallSession,
  endCallSession,
  fetchActiveCalls,
  fetchActiveCall,
  fetchCallRoom,
  fetchCallKeys,
  fetchCallState,
  fetchTurnCredentials,
  fetchCallWebRtcEndpointState,
  joinCallSession,
  leaveCallSession,
  listCallRoomRecipientDevices,
  listRecipientDevices,
  pollCallWebRtcMediaEvents,
  provisionCallWebRtcEndpoint,
  pushCallWebRtcMediaEvent,
  rotateCallKeys,
  sendCallSignal
} from '../lib/api.ts'
import { getDefaultApiBaseUrl } from '../lib/api.ts'
import { buildApiRoot } from '../lib/api-request.ts'
import {
  attachLocalTracksToMembrane,
  cleanupMembraneClient,
  configureMembraneTurnServers,
  connectMembraneClient,
  createMembraneClient,
  getMembranePeerConnection,
  receiveMembraneMediaEvent,
  removeLocalTracksFromMembrane,
  updateMembraneEndpointMetadata,
  type MembraneClient,
  type MembraneRemoteEndpointSnapshot,
  type MembraneRemoteTrackSnapshot
} from '../lib/membrane-native.ts'
import { unwrapWrappedGroupKey, wrapGroupSenderKeyForRecipients } from '../lib/message-vault.ts'
import { bytesToBase64 } from '../lib/base64.ts'
import { subscribeToCallStream } from '../lib/realtime.ts'
import {
  getRawChatId,
  type MergedChatSummary
} from '../lib/multi-server.ts'
import { mergeCallSignals, readMembraneNativeEventType } from '../utils/call-helpers.ts'
import {
  deriveDirectCallStatus,
  isCallCapabilitySupported,
  isDirectCall,
  shouldRefreshTurnCredentials,
  type CallCapabilityState,
  type DirectCallTransportReadiness
} from '../lib/call-runtime.ts'
import {
  findMatchingCallChat,
  resolveActiveCallDiscovery
} from '../lib/call-discovery.ts'
import {
  loadCallStateSnapshot,
  loadChatScopedActiveCall,
  resolveChatScopedActiveCallDecision
} from '../lib/call-state.ts'
import {
  joinExistingCallSession,
  leaveExistingCallSession,
  startAdHocCallSession,
  startChatCallSession,
  summarizeBootstrapSuccess
} from '../lib/call-commands.ts'
import {
  buildJoinPayload,
  computeNextCallKeyEpoch,
  latestCallKeyForDevice as resolveLatestCallKeyForDevice,
  parseMediaSignal
} from '../lib/call-media.ts'
import {
  buildDirectMediaKeySignalPayload,
  buildDirectMediaReadySignalPayload,
  needsNewDirectMediaKeyPair,
  resolveLocalGeneratedGroupKey,
  shouldSyncGroupMediaEncryption
} from '../lib/call-encryption.ts'
import {
  canBootstrapCallTransport,
  deriveTurnRefreshDelay,
  findRemoteMediaKeySignal,
  hasMatchingRemoteReadySignal,
  isParticipantJoined,
  shouldAttachLocalTracks,
  shouldPollMembraneEndpoint,
  shouldSyncDirectMediaEncryption
} from '../lib/call-transport.ts'
import {
  attachLocalTracks as attachCallLocalTracks,
  bootstrapActiveCallTransport,
  syncMembraneWebRtcQueue as syncCallMembraneWebRtcQueue
} from '../lib/call-orchestration.ts'
import {
  syncDirectMediaEncryption as syncCallDirectMediaEncryption,
  syncGroupMediaEncryption as syncCallGroupMediaEncryption
} from '../lib/call-e2ee-sync.ts'
import {
  MediaE2eeController,
  deriveDirectMediaSharedKey,
  generateDirectMediaKeyPair,
  getCallCapability,
  type MediaEncryptionState
} from '../lib/media-e2ee.ts'
import {
  describeMediaDeviceError,
  releaseLocalMediaResources,
  replaceLocalMediaStream,
  stopLocalMediaStream,
  updateHiddenVideoTrackState
} from '../lib/call-local-media.ts'
import {
  acceptIncomingCall,
  buildEndpointPingMetadata,
  declineIncomingCall,
  endActiveCallSession,
  performUnloadCallCleanup,
  pollManualWebRtcEndpoint,
  provisionManualWebRtcEndpoint
} from '../lib/call-runtime-actions.ts'
import type { AuthView } from '../types.ts'

export function useCall(
  view: AuthView,
  deferredActiveChatId: string | null,
  activeChatId: string | null,
  chatItems: MergedChatSummary[]
) {
  const { sessionToken, storedDevice, setLoading, setBanner } = useAppContext()
  const [activeCall, setActiveCall] = useState<CallSession | null>(null)
  const [activeCallChatId, setActiveCallChatId] = useState<string | null>(null)
  const [activeCallRoom, setActiveCallRoom] = useState<CallRoom | null>(null)
  const [activeCallRoomMembers, setActiveCallRoomMembers] = useState<CallRoomMember[]>([])
  const [activeCallDisplayTitle, setActiveCallDisplayTitle] = useState<string | null>(null)
  const [callParticipants, setCallParticipants] = useState<CallParticipant[]>([])
  const [callKeys, setCallKeys] = useState<CallKeyDistribution[]>([])
  const [callRoom, setCallRoom] = useState<CallRoomState | null>(null)
  const [callWebRtcEndpoint, setCallWebRtcEndpoint] = useState<CallWebRtcEndpointState | null>(null)
  const [callWebRtcMediaEvents, setCallWebRtcMediaEvents] = useState<string[]>([])
  const [callSignals, setCallSignals] = useState<CallSignal[]>([])
  const [, setLocalMediaMode] = useState<'none' | 'audio' | 'audio_video'>('none')
  const [localAudioTrackCount, setLocalAudioTrackCount] = useState(0)
  const [localVideoTrackCount, setLocalVideoTrackCount] = useState(0)
  const [turnCredentials, setTurnCredentials] = useState<TurnCredentials | null>(null)
  const [transportError, setTransportError] = useState<string | null>(null)
  const [mediaEncryptionState, setMediaEncryptionState] = useState<MediaEncryptionState>('disabled')
  const [mediaEncryptionFingerprint, setMediaEncryptionFingerprint] = useState<string | null>(null)
  const [currentKeyEpoch, setCurrentKeyEpoch] = useState<number | null>(null)
  const [callCapabilityState, setCallCapabilityState] = useState<CallCapabilityState>('unsupported_browser')
  const [callCapabilityReason, setCallCapabilityReason] = useState<string | null>(null)
  const [isEndingCall, setIsEndingCall] = useState(false)
  const [, setMembraneClientReady] = useState(false)
  const [membraneClientConnected, setMembraneClientConnected] = useState(false)
  const [, setMembraneRemoteEndpointCount] = useState(0)
  const [, setMembraneRemoteTrackCount] = useState(0)
  const [, setMembraneReadyTrackCount] = useState(0)
  const [, setMembraneReadyAudioTrackCount] = useState(0)
  const [, setMembraneReadyVideoTrackCount] = useState(0)
  const [, setMembraneRemoteEndpointIds] = useState<string[]>([])
  const [, setMembraneRemoteTrackIds] = useState<string[]>([])
  const [membraneRemoteEndpoints, setMembraneRemoteEndpoints] = useState<MembraneRemoteEndpointSnapshot[]>([])
  const [membraneRemoteTracks, setMembraneRemoteTracks] = useState<MembraneRemoteTrackSnapshot[]>([])
  const [, setMembraneClientEndpointId] = useState<string | null>(null)

  const callSignalsRef = useRef<CallSignal[]>([])
  const membraneClientRef = useRef<MembraneClient | null>(null)
  const membraneClientCallIdRef = useRef<string | null>(null)
  const membraneLocalTrackIdsRef = useRef<string[]>([])
  const screenShareTrackIdsRef = useRef<string[]>([])
  const localMediaStreamRef = useRef<MediaStream | null>(null)
  const transportBootstrapRef = useRef<Promise<void> | null>(null)
  const membraneConnectRequestedCallIdRef = useRef<string | null>(null)
  const transportStateCallIdRef = useRef<string | null>(null)
  const activeCallScanInFlightRef = useRef(false)
  const activeCallApiBaseUrlRef = useRef(getDefaultApiBaseUrl())
  const mediaE2eeControllerRef = useRef<MediaE2eeController | null>(null)
  const directMediaKeyPairRef = useRef<{ callId: string; keyPair: Awaited<ReturnType<typeof generateDirectMediaKeyPair>> } | null>(null)
  const directMediaFingerprintRef = useRef<string | null>(null)
  const directMediaReadySentForCallRef = useRef<string | null>(null)
  const localGeneratedCallKeysRef = useRef<Record<string, Record<number, string>>>({})
  const hiddenVideoTrackStateRef = useRef(new WeakMap<MediaStreamTrack, boolean>())

  useEffect(() => {
    callSignalsRef.current = callSignals
  }, [callSignals])

  function resetTransportState() {
    setTurnCredentials(null)
    setTransportError(null)
    setIsEndingCall(false)
    transportBootstrapRef.current = null
    membraneConnectRequestedCallIdRef.current = null
  }

  function resetMembraneClient() {
    void removeLocalTracksFromMembrane(membraneClientRef.current, membraneLocalTrackIdsRef.current)
    cleanupMembraneClient(membraneClientRef.current)
    membraneClientRef.current = null
    membraneClientCallIdRef.current = null
    membraneLocalTrackIdsRef.current = []
    membraneConnectRequestedCallIdRef.current = null
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
    resetTransportState()
    resetMembraneClient()
    mediaE2eeControllerRef.current?.teardown()
    mediaE2eeControllerRef.current = null
    directMediaKeyPairRef.current = null
    directMediaFingerprintRef.current = null
    directMediaReadySentForCallRef.current = null
    hiddenVideoTrackStateRef.current = new WeakMap()
    setMediaEncryptionState('disabled')
    setMediaEncryptionFingerprint(null)
    setCurrentKeyEpoch(null)

    stopLocalMediaStream(localMediaStreamRef.current)

    localMediaStreamRef.current = null
    setLocalMediaMode('none')
    setLocalAudioTrackCount(0)
    setLocalVideoTrackCount(0)
  }

  const localDeviceId = storedDevice?.deviceId ?? null
  const callCapability = getCallCapability()
  const mediaEncryptionSupported = isCallCapabilitySupported(callCapability.state)
  const callCapabilityTransport = callCapability.transport
  const callCapabilityBrowserName = callCapability.browserName
  const callCapabilityHostKind = callCapability.hostKind
  const isCallSessionReady = Boolean(sessionToken)
  const activeCallScope: CallScope | null = useMemo(
    () =>
      activeCall?.scope_type === 'call_room' && activeCall.call_room_id
        ? { type: 'call_room', roomId: activeCall.call_room_id }
        : activeCall?.chat_id
          ? { type: 'chat', chatId: activeCall.chat_id }
          : null,
    [activeCall]
  )
  const activeChatSummary = activeChatId
    ? chatItems.find((chat) => chat.id === activeChatId) ?? null
    : null
  const directCallMode =
    activeCall?.mode === 'voice' || activeCall?.mode === 'video' ? activeCall.mode : null
  const transportReadiness: DirectCallTransportReadiness = {
    localMediaReady:
      localMediaStreamRef.current !== null && localAudioTrackCount + localVideoTrackCount > 0,
    endpointReady: Boolean(callWebRtcEndpoint?.exists),
    turnReady: !isDirectCall(activeCall) ? false : !shouldRefreshTurnCredentials(turnCredentials),
    membraneConnected: membraneClientConnected
  }
  const directCallStatus = deriveDirectCallStatus({
    activeCall,
    localDeviceId,
    transportReadiness,
    transportError,
    isEnding: isEndingCall
  })

  useEffect(() => {
    setCallCapabilityState(callCapability.state)
    setCallCapabilityReason(callCapability.reason)
  }, [callCapability.reason, callCapability.state])

  const resolveCapabilityFailureMessage = useCallback((): string => {
    return callCapability.reason ?? 'This browser does not support encrypted calling in Vostok.'
  }, [callCapability.reason])

  const ensureCallCapability = useCallback((actionLabel: string): boolean => {
    if (isCallCapabilitySupported(callCapability.state)) {
      return true
    }

    const message = resolveCapabilityFailureMessage()
    setTransportError(message)
    setBanner({
      tone: 'error',
      message: `${actionLabel} is unavailable. ${message}`
    })
    return false
  }, [callCapability.state, resolveCapabilityFailureMessage, setBanner])

  function ensureMembraneClient(): MembraneClient {
    const activeCallId = activeCall?.id ?? null

    if (!activeCallId || !sessionToken || !storedDevice) {
      throw new Error('No active call is available for Membrane client bootstrap.')
    }

    if (membraneClientRef.current && membraneClientCallIdRef.current === activeCallId) {
      return membraneClientRef.current
    }

    if (membraneClientRef.current) {
      resetMembraneClient()
    }

    const deviceId = storedDevice.deviceId
    const client = createMembraneClient({
      onSendMediaEvent(mediaEvent) {
        console.log('[membrane] sendMediaEvent', mediaEvent.slice(0, 80))
        void pushCallWebRtcMediaEvent(sessionToken, activeCallId, mediaEvent)
          .then((response) => {
            setCallWebRtcEndpoint(response.endpoint)
          })
          .catch((err) => console.warn('[membrane] sendMediaEvent failed', err))
      },
      onConnected(payload) {
        console.log('[membrane] connected', payload.endpointId, 'otherEndpoints:', payload.otherEndpointCount)
        setTransportError(null)
        setMembraneClientConnected(true)
        setMembraneClientEndpointId(payload.endpointId)
        setMembraneRemoteEndpointCount(payload.otherEndpointCount)
      },
      onDisconnected() {
        membraneConnectRequestedCallIdRef.current = null
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
        console.log('[membrane] remoteStateChange', {
          endpoints: payload.endpointCount,
          tracks: payload.trackCount,
          readyTracks: payload.readyTrackCount,
          readyAudio: payload.readyAudioTrackCount,
          readyVideo: payload.readyVideoTrackCount,
          trackDetails: payload.tracks.map((t: { kind?: string | null; ready?: boolean }) => `${t.kind ?? '?'}:${t.ready ? 'ready' : 'pending'}`)
        })
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
        membraneConnectRequestedCallIdRef.current = null
        setTransportError(message)
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
    if (!call || call.status === 'ended') {
      setActiveCall(null)
      setActiveCallChatId(null)
      setActiveCallRoom(null)
      setActiveCallRoomMembers([])
      setActiveCallDisplayTitle(null)
      setCallParticipants([])
      setCallRoom(null)
      setCallWebRtcEndpoint(null)
      setCallWebRtcMediaEvents([])
      callSignalsRef.current = []
      setCallSignals([])
      resetWebRtcLab()
      return
    }

    // Accept ringing and active states from realtime
    setIsEndingCall(false)
    setActiveCall(call)
    if (call.display_title) {
      setActiveCallDisplayTitle(call.display_title)
    }
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

  useEffect(() => {
    const nextCallId = activeCall?.id ?? null

    if (transportStateCallIdRef.current === nextCallId) {
      return
    }

    transportStateCallIdRef.current = nextCallId
    if (nextCallId) {
      activeCallApiBaseUrlRef.current = getDefaultApiBaseUrl()
    }
    resetTransportState()
  }, [activeCall?.id])

  // Load active call on chat change
  useEffect(() => {
    const decision =
      sessionToken && view === 'chat'
        ? resolveChatScopedActiveCallDecision(
            activeCall,
            activeCallChatId,
            deferredActiveChatId,
            getRawChatId
          )
        : { kind: 'reset_all' as const }

    if (!sessionToken || view !== 'chat' || decision.kind === 'reset_all') {
      setActiveCall(null)
      setActiveCallChatId(null)
      setActiveCallRoom(null)
      setActiveCallRoomMembers([])
      setActiveCallDisplayTitle(null)
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

    const token0 = sessionToken
    let cancelled = false

    if (decision.kind === 'preserve_current' || decision.kind === 'preserve_other_chat') {
      return
    }

    if (decision.kind === 'clear_current') {
      setActiveCall(null)
      setActiveCallChatId(null)
      setActiveCallRoom(null)
      setActiveCallRoomMembers([])
      setActiveCallDisplayTitle(null)
      return
    }

    if (decision.kind !== 'load') {
      return
    }

    const targetRawChatId = decision.rawChatId

    async function loadActiveCall() {
      try {
        const response = await loadChatScopedActiveCall(
          token0,
          targetRawChatId,
          deferredActiveChatId!,
          chatItems,
          fetchActiveCall
        )

        if (!cancelled) {
          setActiveCall(response.call)
          setActiveCallChatId(response.activeCallChatId)
          setActiveCallRoom(null)
          setActiveCallRoomMembers([])
          setActiveCallDisplayTitle(response.displayTitle)
        }
      } catch {
        if (!cancelled) {
          setActiveCall(null)
          setActiveCallChatId(null)
          setActiveCallRoom(null)
          setActiveCallRoomMembers([])
          setActiveCallDisplayTitle(null)
        }
      }
    }

    void loadActiveCall()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall, activeCallChatId, deferredActiveChatId, sessionToken, view])

  const refreshActiveCallDiscovery = useEffectEvent(async () => {
    if (!sessionToken || view !== 'chat' || activeCallScanInFlightRef.current) {
      return
    }

    activeCallScanInFlightRef.current = true

    try {
      const response = await fetchActiveCalls(sessionToken)
      const nextCall = response.calls[0] ?? null

      if (!nextCall) {
        if (!activeCall || activeCall.status === 'ringing' || activeCall.status === 'active') {
          setActiveCall(null)
          setActiveCallChatId(null)
          setActiveCallRoom(null)
          setActiveCallRoomMembers([])
          setActiveCallDisplayTitle(null)
        }
        return
      }

      const discovery = resolveActiveCallDiscovery(nextCall, chatItems, {
        activeCall,
        activeCallChatId,
        activeCallRoomId: activeCallRoom?.id ?? null,
        activeCallRoomMemberCount: activeCallRoomMembers.length,
        activeCallDisplayTitle
      })

      if (discovery.matchesCurrentCall) {
        return
      }

      setActiveCall(nextCall)

      if (nextCall.scope_type === 'chat' && nextCall.chat_id) {
        setActiveCallChatId(discovery.nextChatId)
        setActiveCallRoom(null)
        setActiveCallRoomMembers([])
        setActiveCallDisplayTitle(discovery.nextDisplayTitle)
        return
      }

      if (discovery.requiresRoomFetch && nextCall.call_room_id) {
        const roomResponse = await fetchCallRoom(sessionToken, nextCall.call_room_id)
        setActiveCallChatId(null)
        setActiveCallRoom(roomResponse.room)
        setActiveCallRoomMembers(roomResponse.members)
        setActiveCallDisplayTitle(roomResponse.room.title)
      }
    } catch {
      // Ignore background discovery failures; the focused chat call flow remains available.
    } finally {
      activeCallScanInFlightRef.current = false
    }
  })

  // Detect active and incoming calls across both chat-backed and ephemeral room scopes.
  useEffect(() => {
    if (!sessionToken || view !== 'chat') {
      return
    }

    const pollIntervalMs =
      activeCall && (activeCall.status === 'ringing' || activeCall.status === 'active')
        ? 15_000
        : 4_000

    void refreshActiveCallDiscovery()

    const intervalId = window.setInterval(() => {
      void refreshActiveCallDiscovery()
    }, pollIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [activeCall, refreshActiveCallDiscovery, sessionToken, view])

  // Load call state when active call changes
  useEffect(() => {
    if (!sessionToken || !activeCall || view !== 'chat') {
      setCallParticipants([])
      setCallKeys([])
      setCallRoom(null)
      setActiveCallRoom(null)
      setActiveCallRoomMembers([])
      setCallWebRtcEndpoint(null)
      setCallWebRtcMediaEvents([])
      callSignalsRef.current = []
      setCallSignals([])
      resetWebRtcLab()
      return
    }

    const token = sessionToken
    const currentCall = activeCall
    const callId = currentCall.id
    let cancelled = false
    setCallWebRtcMediaEvents([])

    async function loadCallState() {
      try {
        const snapshot = await loadCallStateSnapshot({
          token,
          call: currentCall,
          activeCallChatId,
          chatItems,
          fetchCallState,
          fetchCallRoom,
          fetchCallKeys,
          fetchCallWebRtcEndpointState,
          findMatchingCallChat
        })

        if (!cancelled) {
          setTransportError(null)
          setCallParticipants(snapshot.participants)
          callSignalsRef.current = snapshot.signals
          setCallSignals(snapshot.signals)
          setCallRoom(snapshot.room)
          setActiveCallRoom(snapshot.activeCallRoom)
          setActiveCallRoomMembers(snapshot.activeCallRoomMembers)
          setActiveCallDisplayTitle(snapshot.displayTitle)
          setCallKeys(snapshot.callKeys)
          setCallWebRtcEndpoint(snapshot.endpoint)
        }
      } catch {
        if (!cancelled) {
          setCallParticipants([])
          setCallKeys([])
          setCallRoom(null)
          setActiveCallRoom(null)
          setActiveCallRoomMembers([])
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
  }, [activeCall, sessionToken, view])

  const latestCallKeyForDevice = useCallback((call: CallSession | null): CallKeyDistribution | null => {
    return resolveLatestCallKeyForDevice(call, callKeys, storedDevice?.deviceId ?? null)
  }, [callKeys, storedDevice?.deviceId])

  async function rotateGroupCallKeysFor(call: CallSession, opts?: { quiet?: boolean }) {
    if (!sessionToken || !storedDevice || call.mode !== 'group') {
      return null
    }

    const recipientDeviceResponse =
      call.scope_type === 'call_room' && call.call_room_id
        ? await listCallRoomRecipientDevices(sessionToken, call.call_room_id)
        : call.chat_id
          ? await listRecipientDevices(sessionToken, call.chat_id)
          : { recipient_devices: [] }

    const targetRecipients = recipientDeviceResponse.recipient_devices.filter(
      (device) => device.device_id !== storedDevice.deviceId
    )

    if (targetRecipients.length === 0) {
      return null
    }

    const keyMaterial = bytesToBase64(window.crypto.getRandomValues(new Uint8Array(32)))
    const wrappedKeys = await wrapGroupSenderKeyForRecipients(keyMaterial, targetRecipients)
    const nextEpoch = computeNextCallKeyEpoch(callKeys)
    const nextLocalKeys = { ...(localGeneratedCallKeysRef.current[call.id] ?? {}), [nextEpoch]: keyMaterial }
    localGeneratedCallKeysRef.current = {
      ...localGeneratedCallKeysRef.current,
      [call.id]: nextLocalKeys
    }
    const response = await rotateCallKeys(sessionToken, call.id, {
      key_epoch: nextEpoch,
      algorithm: 'sframe-aes-gcm-v1',
      wrapped_keys: wrappedKeys
    })

    setCallKeys(response.keys)

    if (!opts?.quiet) {
      setBanner({
        tone: 'success',
        message: `Call key epoch ${nextEpoch} rotated for ${response.keys.length} participant device${response.keys.length === 1 ? '' : 's'}.`
      })
    }

    return response.keys
  }

  function ensureMediaE2eeController() {
    if (!mediaE2eeControllerRef.current) {
      mediaE2eeControllerRef.current = new MediaE2eeController()
    }

    return mediaE2eeControllerRef.current
  }
  const bootstrapDirectCallTransport = useEffectEvent(async () => {
    if (!canBootstrapCallTransport({
      activeCall,
      sessionToken,
      storedDeviceId: storedDevice?.deviceId ?? null,
      view
    })) {
      return
    }

    if (!sessionToken || !activeCall || !storedDevice) {
      return
    }
    const currentSessionToken = sessionToken
    const currentCall = activeCall
    const currentDevice = storedDevice

    if (!ensureCallCapability('Call transport')) {
      return
    }

    if (transportBootstrapRef.current) {
      await transportBootstrapRef.current
      return
    }

    const bootstrap = (async () => {
      console.log('[call] bootstrap START', { callId: currentCall.id, hasEndpoint: !!callWebRtcEndpoint?.exists, membraneConnected: membraneClientConnected })
      setTransportError(null)
      const result = await bootstrapActiveCallTransport({
        currentCall,
        currentDevice,
        currentSessionToken,
        turnCredentials,
        shouldRefreshTurnCredentials,
        fetchTurnCredentials,
        callParticipants,
        isParticipantJoined,
        latestCallKey: latestCallKeyForDevice(currentCall),
        rotateGroupCallKeysFor,
        buildJoinPayload,
        joinCallSession,
        currentEndpoint: callWebRtcEndpoint,
        currentRoom: callRoom,
        provisionCallWebRtcEndpoint,
        ensureMembraneClient,
        configureMembraneTurnServers,
        membraneClientConnected,
        membraneConnectRequestedCallId: membraneConnectRequestedCallIdRef.current,
        connectMembraneClient
      })

      console.log('[call] bootstrap DONE', { endpointExists: result.endpoint?.exists, membraneRequested: result.membraneConnectRequestedCallId })
      setTurnCredentials(result.turnCredentials)
      if (result.participants) {
        setCallParticipants(result.participants)
      }
      setCallRoom(result.room)
      setCallWebRtcEndpoint(result.endpoint)
      membraneConnectRequestedCallIdRef.current = result.membraneConnectRequestedCallId
    })()
      .catch((error) => {
        console.error('[call] bootstrap FAILED', error)
        const message =
          error instanceof Error ? error.message : 'Failed to initialize direct call transport.'
        setTransportError(message)
        setBanner({ tone: 'error', message })
        transportBootstrapRef.current = null
      })

    transportBootstrapRef.current = bootstrap
    await bootstrap
  })

  useEffect(() => {
    if (!canBootstrapCallTransport({
      activeCall,
      sessionToken,
      storedDeviceId: storedDevice?.deviceId ?? null,
      view
    })) {
      return
    }

    void bootstrapDirectCallTransport()
  // bootstrapDirectCallTransport is a useEffectEvent — it reads current state
  // internally, so only true triggers (call identity, auth, view) belong here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeCall?.id,
    activeCall?.status,
    sessionToken,
    storedDevice?.deviceId,
    membraneClientConnected,
    view
  ])

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active' || !turnCredentials) {
      return
    }

    const refreshInMs = deriveTurnRefreshDelay(turnCredentials)

    if (refreshInMs == null) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      setTurnCredentials((current) => (shouldRefreshTurnCredentials(current) ? null : current))
    }, refreshInMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [activeCall, turnCredentials])

  // Poll Membrane WebRTC endpoint
  useEffect(() => {
    if (!shouldPollMembraneEndpoint({
      activeCall,
      sessionToken,
      view,
      endpointExists: Boolean(callWebRtcEndpoint?.exists)
    })) {
      console.log('[membrane] poll skipped', { callStatus: activeCall?.status, endpointExists: Boolean(callWebRtcEndpoint?.exists), view })
      return
    }

    console.log('[membrane] poll started', { callId: activeCall?.id, endpointExists: callWebRtcEndpoint?.exists })

    if (!sessionToken || !activeCall) {
      return
    }
    const token2 = sessionToken
    const currentCall = activeCall
    const callId = currentCall.id
    let cancelled = false
    let inFlight = false

    async function syncMembraneWebRtcQueue() {
      if (cancelled || inFlight) {
        return
      }

      inFlight = true

      try {
        const response = await syncCallMembraneWebRtcQueue(
          token2,
          callId,
          pollCallWebRtcMediaEvents
        )

        if (!cancelled) {
          if (response.mediaEvents.length > 0) {
            console.log('[membrane] poll got events:', response.mediaEvents.length, response.mediaEvents.map((e: string) => e.slice(0, 50)))
          }
          setCallWebRtcEndpoint(response.endpoint)
          handleMembraneQueueBatch(response.mediaEvents)
        }
      } catch (err) {
        console.warn('[membrane] poll error', err)
        // Ignore transient poll errors and continue interval polling.
      } finally {
        inFlight = false
      }
    }

    void syncMembraneWebRtcQueue()
    const intervalId = window.setInterval(() => void syncMembraneWebRtcQueue(), 1_000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeCall, callWebRtcEndpoint?.exists, sessionToken, view])

  // ICE reconnection — monitor ICE connection state and re-bootstrap on transient failures
  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active' || !membraneClientConnected) return

    const pc = getMembranePeerConnection(membraneClientRef.current)
    if (!pc) return

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    function handleIceStateChange() {
      const state = pc!.iceConnectionState

      if (state === 'disconnected') {
        // Brief disconnect — wait 3s then try reconnect
        reconnectTimer = setTimeout(() => {
          if (pc!.iceConnectionState === 'disconnected' || pc!.iceConnectionState === 'failed') {
            // Clear the connect request ref so bootstrapActiveCallTransport allows a reconnect
            membraneConnectRequestedCallIdRef.current = null
            setMembraneClientConnected(false)
          }
        }, 3000)
      } else if (state === 'failed') {
        // Immediate reconnect attempt
        membraneConnectRequestedCallIdRef.current = null
        setMembraneClientConnected(false)
      } else if (state === 'connected') {
        // Recovered — clear any pending reconnect timer
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
      }
    }

    pc.addEventListener('iceconnectionstatechange', handleIceStateChange)

    return () => {
      pc.removeEventListener('iceconnectionstatechange', handleIceStateChange)
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [activeCall, membraneClientConnected])

  // Attach local tracks to Membrane
  useEffect(() => {
    if (!shouldAttachLocalTracks({
      activeCall,
      sessionToken,
      view,
      membraneClientConnected,
      hasMembraneClient: Boolean(membraneClientRef.current),
      hasLocalMediaStream: Boolean(localMediaStreamRef.current),
      localTrackIdsAttached: membraneLocalTrackIdsRef.current.length > 0
    })) {
      return
    }

    const membraneClient = membraneClientRef.current
    const localStream = localMediaStreamRef.current
    if (!membraneClient || !localStream) {
      return
    }
    const currentMembraneClient = membraneClient
    const currentLocalStream = localStream
    let cancelled = false

    async function syncTracks() {
      try {
        const trackIds = await attachCallLocalTracks(
          currentMembraneClient,
          currentLocalStream,
          attachLocalTracksToMembrane
        )

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
  }, [activeCall, localAudioTrackCount, localVideoTrackCount, membraneClientConnected, sessionToken, setBanner, view])

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active') {
      return
    }

    if (!mediaEncryptionSupported) {
      setTransportError(resolveCapabilityFailureMessage())
      return
    }

    if (!mediaEncryptionSupported || !membraneClientConnected) {
      return
    }

    const connection = getMembranePeerConnection(membraneClientRef.current)

    if (!connection) {
      return
    }

    ensureMediaE2eeController().attach(connection)
  }, [activeCall, mediaEncryptionSupported, membraneClientConnected, resolveCapabilityFailureMessage])

  useEffect(() => {
    if (!activeCall || (activeCall.status !== 'ringing' && activeCall.status !== 'active')) {
      return
    }

    if (mediaEncryptionSupported) {
      return
    }

    setTransportError(resolveCapabilityFailureMessage())
  }, [activeCall, mediaEncryptionSupported, resolveCapabilityFailureMessage])

  useEffect(() => {
    const groupMediaSyncState = shouldSyncGroupMediaEncryption(
      activeCall,
      mediaEncryptionSupported,
      storedDevice,
      membraneClientConnected
    )

    if (groupMediaSyncState === 'skip') {
      return
    }

    if (groupMediaSyncState === 'disabled') {
      setMediaEncryptionState('disabled')
      setMediaEncryptionFingerprint(null)
      setCurrentKeyEpoch(null)
      return
    }

    if (!activeCall || !storedDevice) {
      return
    }

    const currentCall = activeCall
    const currentDevice = storedDevice
    let cancelled = false

    async function syncGroupMediaEncryption() {
      const result = await syncCallGroupMediaEncryption({
        activeCall: currentCall,
        currentDevice,
        latestCallKey: latestCallKeyForDevice(currentCall),
        localGeneratedCallKeys: localGeneratedCallKeysRef.current,
        resolveLocalGeneratedGroupKey,
        unwrapWrappedGroupKey,
        membraneClient: membraneClientRef.current,
        getPeerConnection: (client) => getMembranePeerConnection(client as MembraneClient | null),
        ensureController: ensureMediaE2eeController,
        updateControllerKey: (controller, keyMaterialBase64) => controller.updateKey(keyMaterialBase64),
        attachController: (controller, connection) => controller.attach(connection)
      })

      if (cancelled) {
        return
      }

      setMediaEncryptionState(result.state)
      setCurrentKeyEpoch(result.currentKeyEpoch)
      setMediaEncryptionFingerprint(result.fingerprint)
    }

    void syncGroupMediaEncryption()

    return () => {
      cancelled = true
    }
  }, [activeCall, callKeys, latestCallKeyForDevice, mediaEncryptionSupported, membraneClientConnected, storedDevice])

  useEffect(() => {
    const directMediaSyncState = shouldSyncDirectMediaEncryption(
      activeCall,
      mediaEncryptionSupported,
      sessionToken,
      membraneClientConnected
    )

    if (directMediaSyncState === 'skip') {
      return
    }

    if (directMediaSyncState === 'disabled') {
      setMediaEncryptionState('disabled')
      setMediaEncryptionFingerprint(null)
      setCurrentKeyEpoch(null)
      return
    }

    if (directMediaSyncState === 'negotiating') {
      setMediaEncryptionState('negotiating')
      return
    }

    if (!activeCall || !sessionToken) {
      return
    }
    const currentCall = activeCall
    const currentSessionToken = sessionToken
    let cancelled = false

    async function syncDirectMediaEncryption() {
      setMediaEncryptionState('negotiating')

      const result = await syncCallDirectMediaEncryption({
        activeCall: currentCall,
        sessionToken: currentSessionToken,
        callSignals,
        localDeviceId,
        currentPairEntry: directMediaKeyPairRef.current,
        readySentForCallId: directMediaReadySentForCallRef.current,
        needsNewDirectMediaKeyPair,
        generateDirectMediaKeyPair,
        sendCallSignal,
        buildDirectMediaKeySignalPayload,
        findRemoteMediaKeySignal,
        parseMediaSignal,
        deriveDirectMediaSharedKey,
        membraneClient: membraneClientRef.current,
        getPeerConnection: (client) => getMembranePeerConnection(client as MembraneClient | null),
        ensureController: ensureMediaE2eeController,
        updateControllerKey: (controller, keyMaterialBase64) => controller.updateKey(keyMaterialBase64),
        attachController: (controller, connection) => controller.attach(connection),
        buildDirectMediaReadySignalPayload,
        hasMatchingRemoteReadySignal
      })

      if (cancelled) {
        return
      }

      directMediaKeyPairRef.current = result.nextPairEntry
      directMediaReadySentForCallRef.current = result.readySentForCallId
      directMediaFingerprintRef.current = result.fingerprint
      setMediaEncryptionFingerprint(result.fingerprint)
      setCurrentKeyEpoch(result.currentKeyEpoch)
      setMediaEncryptionState(result.state)
    }

    void syncDirectMediaEncryption().catch((error) => {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : 'Media encryption failed.'
        setMediaEncryptionState('error')
        setTransportError(message)
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeCall, callSignals, localDeviceId, mediaEncryptionSupported, membraneClientConnected, sessionToken])

  // Subscribe to call stream
  useEffect(() => {
    const subscribedScope =
      activeCallScope ??
      (deferredActiveChatId && getRawChatId(deferredActiveChatId)
        ? { type: 'chat', chatId: getRawChatId(deferredActiveChatId)! }
        : null)

    if (!sessionToken || !subscribedScope || view !== 'chat') {
      return
    }

    return subscribeToCallStream(sessionToken, subscribedScope, {
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
  }, [activeCallScope, deferredActiveChatId, sessionToken, view])

  async function handleStartCall(mode: 'voice' | 'video' | 'group') {
    const rawActiveChatId = getRawChatId(activeChatId)

    if (!sessionToken || !activeChatId || !rawActiveChatId) {
      return
    }

    if (!ensureCallCapability(mode === 'group' ? 'Group call setup' : 'Call setup')) {
      return
    }

    setLoading(true)
    resetTransportState()

    try {
      const result = await startChatCallSession(
        sessionToken,
        rawActiveChatId,
        activeChatId,
        activeChatSummary,
        mode,
        createCallSession
      )
      setActiveCall(result.call)
      setActiveCallChatId(result.activeCallChatId)
      setActiveCallRoom(null)
      setActiveCallRoomMembers([])
      setActiveCallDisplayTitle(result.displayTitle)
      setBanner({
        tone: 'success',
        message: result.message
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start call.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleStartAdHocCall(participantIds: string[], mediaMode: 'voice' | 'video', title?: string) {
    if (!sessionToken || participantIds.length === 0) {
      return
    }

    if (!ensureCallCapability('Ad-hoc group calling')) {
      return
    }

    setLoading(true)
    resetTransportState()

    try {
      const result = await startAdHocCallSession(
        sessionToken,
        participantIds,
        mediaMode,
        title,
        createCallRoom,
        createCallRoomSession
      )
      setActiveCall(result.call)
      setActiveCallChatId(null)
      setActiveCallRoom(result.room)
      setActiveCallRoomMembers(result.members)
      setActiveCallDisplayTitle(result.displayTitle)
      setBanner({
        tone: 'success',
        message: result.message
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start ad-hoc group call.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleAcceptCall() {
    if (!sessionToken || !activeCall) {
      return
    }

    if (!ensureCallCapability('Accepting calls')) {
      return
    }

    setLoading(true)

    try {
      const result = await acceptIncomingCall(
        sessionToken,
        activeCall.id,
        acceptCallSession
      )
      setTransportError(null)
      setActiveCall(result.call)
      setBanner({ tone: 'success', message: result.message })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to accept call.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleDeclineCall() {
    if (!sessionToken || !activeCall) {
      return
    }

    setIsEndingCall(true)
    setLoading(true)

    try {
      const result = await declineIncomingCall(
        sessionToken,
        activeCall.id,
        activeCallChatId,
        declineCallSession
      )
      setActiveCall(result.call)
      setActiveCallChatId(result.activeCallChatId)
      setBanner({ tone: 'info', message: result.message })
    } catch (error) {
      setIsEndingCall(false)
      const message = error instanceof Error ? error.message : 'Failed to decline call.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleEndCall() {
    if (!sessionToken || !activeCall) {
      return
    }

    setIsEndingCall(true)
    setLoading(true)

    try {
      const result = await endActiveCallSession(
        sessionToken,
        activeCall.id,
        activeCallChatId,
        endCallSession
      )
      setActiveCall(result.call)
      setActiveCallChatId(result.activeCallChatId)
      setBanner({ tone: 'success', message: result.message })
    } catch (error) {
      setIsEndingCall(false)
      const message = error instanceof Error ? error.message : 'Failed to end call.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleJoinActiveCall() {
    if (!sessionToken || !activeCall) {
      return
    }

    if (!ensureCallCapability('Joining the active call')) {
      return
    }

    setLoading(true)

    try {
      const result = await joinExistingCallSession({
        sessionToken,
        activeCall,
        storedDevice,
        latestCallKey: latestCallKeyForDevice(activeCall),
        rotateGroupCallKeysFor,
        buildJoinPayload,
        joinCallSession,
        fetchCallWebRtcEndpointState
      })

      if ('blockedMessage' in result) {
        setBanner({
          tone: 'error',
          message: result.blockedMessage
        })
        return
      }

      setCallParticipants(result.participants)
      setCallRoom(result.room)
      setCallWebRtcEndpoint(result.endpoint)
      setBanner({
        tone: 'success',
        message: result.message
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to join the active call.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleRotateCallKeyEpoch() {
    if (!sessionToken || !storedDevice || !activeCall) {
      return
    }

    setLoading(true)

    try {
      await rotateGroupCallKeysFor(activeCall)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rotate call key epoch.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleLeaveActiveCall() {
    if (!sessionToken || !activeCall) {
      return
    }

    setIsEndingCall(true)
    setLoading(true)

    try {
      const result = await leaveExistingCallSession(
        sessionToken,
        activeCall,
        leaveCallSession,
        fetchCallWebRtcEndpointState
      )
      setIsEndingCall(false)
      setCallParticipants(result.participants)
      setCallRoom(result.room)
      setCallWebRtcEndpoint(result.endpoint)
      setCallWebRtcMediaEvents([])
      setBanner({ tone: 'success', message: result.message })
    } catch (error) {
      setIsEndingCall(false)
      const message = error instanceof Error ? error.message : 'Failed to leave the active call.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleProvisionMembraneWebRtcEndpoint() {
    if (!sessionToken || !activeCall) {
      return
    }

    setLoading(true)

    try {
      const result = await provisionManualWebRtcEndpoint(
        sessionToken,
        activeCall.id,
        provisionCallWebRtcEndpoint
      )
      setCallWebRtcEndpoint(result.endpoint)
      setCallRoom(result.room)
      setBanner({
        tone: 'success',
        message: result.message
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
    if (!sessionToken || !activeCall) {
      return
    }

    setLoading(true)

    try {
      const result = await pollManualWebRtcEndpoint(
        sessionToken,
        activeCall.id,
        syncCallMembraneWebRtcQueue,
        pollCallWebRtcMediaEvents
      )
      setCallWebRtcEndpoint(result.endpoint)
      setCallWebRtcMediaEvents((current) =>
        [...result.mediaEvents.reverse(), ...current].slice(0, 8)
      )
      setBanner({ tone: 'success', message: result.message })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to poll the Membrane WebRTC endpoint.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handlePingMembraneWebRtcEndpoint() {
    if (!sessionToken || !activeCall) {
      return
    }

    setLoading(true)

    try {
      const client = membraneClientRef.current

      if (!client) {
        throw new Error('Initialize WebRTC + Membrane before sending native endpoint updates.')
      }

      updateMembraneEndpointMetadata(client, buildEndpointPingMetadata(activeCall))
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
    if (!activeCall || !sessionToken || !storedDevice) {
      return
    }

    if (!ensureCallCapability('WebRTC initialization')) {
      return
    }

    setLoading(true)

    try {
      const result = summarizeBootstrapSuccess(await bootstrapActiveCallTransport({
        currentCall: activeCall,
        currentDevice: storedDevice,
        currentSessionToken: sessionToken,
        turnCredentials,
        shouldRefreshTurnCredentials,
        fetchTurnCredentials,
        callParticipants,
        isParticipantJoined,
        latestCallKey: latestCallKeyForDevice(activeCall),
        rotateGroupCallKeysFor,
        buildJoinPayload,
        joinCallSession,
        currentEndpoint: callWebRtcEndpoint,
        currentRoom: callRoom,
        provisionCallWebRtcEndpoint,
        ensureMembraneClient,
        configureMembraneTurnServers,
        membraneClientConnected,
        membraneConnectRequestedCallId: membraneConnectRequestedCallIdRef.current,
        connectMembraneClient
      }))
      setTurnCredentials(result.turnCredentials)
      if (result.participants) {
        setCallParticipants(result.participants)
      }
      setCallWebRtcEndpoint(result.endpoint)
      setCallRoom(result.room)
      membraneConnectRequestedCallIdRef.current = result.membraneConnectRequestedCallId
      setBanner({
        tone: 'success',
        message: result.message
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

    if (!ensureCallCapability('Local media attachment')) {
      return
    }

    console.log('[call] attachLocalMedia', mode, 'membraneConnected:', membraneClientConnected, 'hasClient:', !!membraneClientRef.current)

    setLoading(true)

    try {
      const result = await replaceLocalMediaStream({
        mode,
        currentStream: localMediaStreamRef.current,
        membraneClient: membraneClientRef.current,
        membraneClientConnected,
        membraneLocalTrackIds: membraneLocalTrackIdsRef.current,
        removeLocalTracksFromMembrane,
        getUserMedia: (constraints) => window.navigator.mediaDevices.getUserMedia(constraints),
        attachLocalTracks: (client, stream) =>
          attachCallLocalTracks(client, stream, attachLocalTracksToMembrane)
      })

      console.log('[call] attachLocalMedia result', { trackIds: result.trackIds, audioTracks: result.localAudioTrackCount, videoTracks: result.localVideoTrackCount })

      localMediaStreamRef.current = result.stream
      membraneLocalTrackIdsRef.current = result.trackIds
      setLocalMediaMode(result.localMediaMode)
      setLocalAudioTrackCount(result.localAudioTrackCount)
      setLocalVideoTrackCount(result.localVideoTrackCount)
    } catch (error) {
      const message = describeMediaDeviceError(error)
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleReleaseLocalMedia() {
    await releaseLocalMediaResources(
      membraneClientRef.current,
      membraneLocalTrackIdsRef.current,
      localMediaStreamRef.current,
      removeLocalTracksFromMembrane
    )
    membraneLocalTrackIdsRef.current = []

    localMediaStreamRef.current = null
    setLocalMediaMode('none')
    setLocalAudioTrackCount(0)
    setLocalVideoTrackCount(0)
    setBanner({
      tone: 'success',
      message: 'Local microphone/camera tracks were removed from the native Membrane pipeline.'
    })
  }

  async function _handleAttachScreenShare(stream: MediaStream): Promise<string[]> {
    const client = membraneClientRef.current
    if (!client || !membraneClientConnected) return []

    const trackIds: string[] = []
    for (const track of stream.getTracks()) {
      const trackId = await client.addTrack(track, stream, {
        kind: track.kind as 'audio' | 'video',
        source: 'screenshare'
      })
      trackIds.push(trackId)
    }
    screenShareTrackIdsRef.current = trackIds
    return trackIds
  }

  async function _handleDetachScreenShare() {
    await removeLocalTracksFromMembrane(membraneClientRef.current, screenShareTrackIdsRef.current)
    screenShareTrackIdsRef.current = []
  }

  async function _handleSwitchDevice(deviceId: string, kind: 'audio' | 'video') {
    if (!activeCall) return

    const currentMode = localVideoTrackCount > 0 ? 'audio_video' : 'audio'

    try {
      const audioConstraint = kind === 'audio'
        ? { deviceId: { exact: deviceId } }
        : true
      const videoConstraint = kind === 'video'
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : currentMode === 'audio_video'
          ? { width: { ideal: 1280 }, height: { ideal: 720 } }
          : false

      const result = await replaceLocalMediaStream({
        mode: videoConstraint ? 'audio_video' : 'audio',
        currentStream: localMediaStreamRef.current,
        membraneClient: membraneClientRef.current,
        membraneClientConnected,
        membraneLocalTrackIds: membraneLocalTrackIdsRef.current,
        removeLocalTracksFromMembrane,
        getUserMedia: () => window.navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: videoConstraint
        }),
        attachLocalTracks: (client, stream) =>
          attachCallLocalTracks(client, stream, attachLocalTracksToMembrane)
      })

      localMediaStreamRef.current = result.stream
      membraneLocalTrackIdsRef.current = result.trackIds
      setLocalMediaMode(result.localMediaMode)
      setLocalAudioTrackCount(result.localAudioTrackCount)
      setLocalVideoTrackCount(result.localVideoTrackCount)
    } catch (error) {
      const message = describeMediaDeviceError(error)
      setBanner({ tone: 'error', message })
    }
  }

  // ── Page unload: end call and release media ─────────────────────────
  useEffect(() => {
    function handleUnload() {
      const currentStream = localMediaStreamRef.current
      localMediaStreamRef.current = null
      void performUnloadCallCleanup(
        currentStream,
        stopLocalMediaStream,
        activeCall,
        sessionToken,
        activeCallApiBaseUrlRef.current,
        fetch
      ).catch(() => {})
    }

    window.addEventListener('beforeunload', handleUnload)
    window.addEventListener('pagehide', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      window.removeEventListener('pagehide', handleUnload)
    }
  }, [activeCall, sessionToken])

  // ── Background tab: pause video tracks to save resources ──────────
  useEffect(() => {
    function handleVisibilityChange() {
      updateHiddenVideoTrackState(
        localMediaStreamRef.current,
        document.hidden,
        hiddenVideoTrackStateRef.current
      )

      if (!document.hidden) {
        void refreshActiveCallDiscovery()
        if (activeCall?.status === 'active' && mediaEncryptionSupported) {
          void bootstrapDirectCallTransport()
        }
      }
    }

    function handlePageShow() {
      void refreshActiveCallDiscovery()
      if (activeCall?.status === 'active' && mediaEncryptionSupported) {
        void bootstrapDirectCallTransport()
      }
    }

    function handleWindowFocus() {
      void refreshActiveCallDiscovery()
    }

    function handleWindowOnline() {
      void refreshActiveCallDiscovery()
      if (activeCall?.status === 'active' && mediaEncryptionSupported) {
        void bootstrapDirectCallTransport()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('online', handleWindowOnline)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('online', handleWindowOnline)
    }
  }, [activeCall, bootstrapDirectCallTransport, mediaEncryptionSupported, refreshActiveCallDiscovery])

  function resetCallState() {
    setActiveCall(null)
    setActiveCallChatId(null)
    setActiveCallRoom(null)
    setActiveCallRoomMembers([])
    setActiveCallDisplayTitle(null)
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
    activeCallScope,
    activeCallChatId,
    activeCallRoom,
    activeCallRoomMembers,
    activeCallDisplayTitle,
    callParticipants,
    callRoom,
    callWebRtcEndpoint,
    callWebRtcMediaEvents,
    directCallMode,
    directCallStatus,
    isCallSessionReady,
    callCapabilityState,
    callCapabilityReason,
    callCapabilityTransport,
    callCapabilityBrowserName,
    callCapabilityHostKind,
    mediaEncryptionState,
    mediaEncryptionSupported,
    mediaEncryptionFingerprint,
    currentKeyEpoch,
    transportError,
    transportReadiness,
    turnCredentials,
    setActiveCall,
    callSignals,
    membraneRemoteEndpoints,
    membraneRemoteTracks,
    handleStartCall,
    handleStartAdHocCall,
    handleAcceptCall,
    handleDeclineCall,
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
    _handleAttachScreenShare,
    _handleDetachScreenShare,
    _handleSwitchDevice,
    localMediaStreamRef,
    membraneClientRef,
    resetCallState,
    resetWebRtcLab,
    setCallParticipants,
    setCallRoom,
    setCallWebRtcEndpoint,
    setCallWebRtcMediaEvents
  }
}
