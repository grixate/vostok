import { useState, useEffect, useRef, useEffectEvent, useMemo, useCallback } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type {
  CallParticipant,
  CallRoom,
  CallRoomMember,
  CallRoomState,
  CallScope,
  CallSession,
  CallSignal,
  PrekeyDeviceBundle,
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
  fetchCallState,
  fetchUserPrekeys,
  fetchTurnCredentials,
  fetchCallWebRtcEndpointState,
  joinCallSession,
  leaveCallSession,
  pollCallWebRtcMediaEvents,
  provisionCallWebRtcEndpoint,
  pushCallWebRtcMediaEvent,
  sendCallSignal
} from '../lib/api.ts'
import { getDefaultApiBaseUrl } from '../lib/api.ts'
import {
  attachLocalTrackToMembrane,
  attachLocalTracksToMembrane,
  canMutateMembraneTracks,
  cleanupMembraneClient,
  configureMembraneTurnServers,
  connectMembraneClient,
  createMembraneClient,
  findMembraneLocalTrackId,
  getMembraneLocalTrackSnapshots,
  filterOutgoingMembraneCandidateEvent,
  getMembranePeerConnection,
  getMembranePeerConnectionSnapshot,
  receiveMembraneMediaEvent,
  removeLocalTracksFromMembrane,
  replaceLocalTrackInMembrane,
  shouldSkipStaleMembraneMediaEvent,
  updateMembraneEndpointMetadata,
  type MembraneClient,
  type MembraneRemoteEndpointSnapshot,
  type MembraneRemoteTrackSnapshot
} from '../lib/membrane-native.ts'
import { subscribeToCallStream } from '../lib/realtime.ts'
import {
  getRawChatId,
  type MergedChatSummary
} from '../lib/multi-server.ts'
import {
  mergeCallSignals,
  readMembraneNativeEventType
} from '../utils/call-helpers.ts'
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
} from '../lib/call-media.ts'
import {
  shouldSyncGroupMediaEncryption
} from '../lib/call-encryption.ts'
import {
  canBootstrapCallTransport,
  deriveTurnRefreshDelay,
  isParticipantJoined,
  shouldAttachLocalTracks,
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
  getCallCapability,
  type MediaEncryptionState
} from '../lib/media-e2ee.ts'
import {
  ensureSessionForDevice,
  type SignalContext,
  type VostokPrekeyBundle
} from '../lib/signal-bridge.ts'
import {
  describeMediaDeviceError,
  releaseLocalMediaResources,
  replaceLocalMediaStream,
  stopLocalMediaStream,
  updateHiddenVideoTrackState
} from '../lib/call-local-media.ts'
import {
  applyCallQualityProfileToPeerConnection,
  buildCallAudioTrackConstraints,
  buildCallVideoTrackConstraints,
  chooseCallQualityProfileWithHysteresis,
  DEFAULT_CALL_QUALITY_HYSTERESIS,
  deriveCallQualityIndicator,
  deriveCallTransportStatus,
  describeCallQualityProfile,
  recommendCallQualityProfile,
  type CallQualityHysteresisState,
  type CallQualityIndicator,
  type CallQualityProfile,
  type CallTransportStatus
} from '../lib/call-quality-policy.ts'
import {
  CALL_EVENT_DEDUPE_WINDOW_MS,
  CALL_REALTIME_EVENT_ARBITRATION_WINDOW_MS,
  CALL_RECONNECT_EVENT_QUEUE_LIMIT,
  isCallDebugVerboseEnabled,
  nextReconnectDelayMs,
  selectPrimaryLocalSenderTrackIds,
  shouldBypassMembraneEventDedupe,
  shouldSkipPolledCriticalEvent,
  shouldResetReconnectAttempts
} from '../lib/call-stability.ts'
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

type PlaceholderTrack = MediaStreamTrack & {
  __vostokPlaceholderSource?: true
}

function markPlaceholderTrack(track: MediaStreamTrack): MediaStreamTrack {
  ;(track as PlaceholderTrack).__vostokPlaceholderSource = true
  return track
}

function isPlaceholderTrack(track: MediaStreamTrack | null | undefined): boolean {
  return Boolean(track && (track as PlaceholderTrack).__vostokPlaceholderSource)
}

const CALL_DEBUG_ENABLED = import.meta.env.DEV
const CALL_DEBUG_VERBOSE_BUILD = import.meta.env.VITE_CALL_DEBUG_VERBOSE === 'true'

type ReconnectLifecycleState = 'idle' | 'reconnecting' | 'stable'
type MembraneQueueSource = 'realtime' | 'poll' | 'replay'
type MembraneRemoteStatePayload = {
  endpointCount: number
  trackCount: number
  endpointIds: string[]
  trackIds: string[]
  readyTrackCount: number
  readyAudioTrackCount: number
  readyVideoTrackCount: number
  endpoints: MembraneRemoteEndpointSnapshot[]
  tracks: MembraneRemoteTrackSnapshot[]
}

const REMOTE_STATE_THROTTLE_MS = 120

export function useCall(
  view: AuthView,
  deferredActiveChatId: string | null,
  activeChatId: string | null,
  chatItems: MergedChatSummary[]
) {
  type LocalTrackBinding = {
    trackId: string
    kind: 'audio' | 'video'
    mediaTrackId: string
    source: 'browser' | 'placeholder'
  }

  const { sessionToken, storedDevice, setLoading, setBanner } = useAppContext()
  const [activeCall, setActiveCall] = useState<CallSession | null>(null)
  const [activeCallChatId, setActiveCallChatId] = useState<string | null>(null)
  const [activeCallRoom, setActiveCallRoom] = useState<CallRoom | null>(null)
  const [activeCallRoomMembers, setActiveCallRoomMembers] = useState<CallRoomMember[]>([])
  const [activeCallDisplayTitle, setActiveCallDisplayTitle] = useState<string | null>(null)
  const [callParticipants, setCallParticipants] = useState<CallParticipant[]>([])
  const [callRoom, setCallRoom] = useState<CallRoomState | null>(null)
  const [callWebRtcEndpoint, setCallWebRtcEndpoint] = useState<CallWebRtcEndpointState | null>(null)
  const [callWebRtcMediaEvents, setCallWebRtcMediaEvents] = useState<string[]>([])
  const [callSignals, setCallSignals] = useState<CallSignal[]>([])
  const [, setLocalMediaMode] = useState<'none' | 'audio' | 'audio_video'>('none')
  const [localAudioTrackCount, setLocalAudioTrackCount] = useState(0)
  const [localVideoTrackCount, setLocalVideoTrackCount] = useState(0)
  const [turnCredentials, setTurnCredentials] = useState<TurnCredentials | null>(null)
  const [transportError, setTransportError] = useState<string | null>(null)
  const [transportReconnectVersion, setTransportReconnectVersion] = useState(0)
  const [reconnectState, setReconnectState] = useState<ReconnectLifecycleState>('idle')
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
  const [membraneReadyTrackCount, setMembraneReadyTrackCount] = useState(0)
  const [membraneReadyAudioTrackCount, setMembraneReadyAudioTrackCount] = useState(0)
  const [membraneReadyVideoTrackCount, setMembraneReadyVideoTrackCount] = useState(0)
  const [, setMembraneRemoteEndpointIds] = useState<string[]>([])
  const [, setMembraneRemoteTrackIds] = useState<string[]>([])
  const [membraneRemoteEndpoints, setMembraneRemoteEndpoints] = useState<MembraneRemoteEndpointSnapshot[]>([])
  const [membraneRemoteTracks, setMembraneRemoteTracks] = useState<MembraneRemoteTrackSnapshot[]>([])
  const [, setMembraneClientEndpointId] = useState<string | null>(null)
  const [localAudioSource, setLocalAudioSource] = useState<'none' | 'browser' | 'placeholder'>('none')
  const [localVideoSource, setLocalVideoSource] = useState<'none' | 'browser' | 'placeholder'>('none')
  const [callTransportStatus, setCallTransportStatus] = useState<CallTransportStatus>('connected')
  const [callQualityIndicator, setCallQualityIndicator] = useState<CallQualityIndicator>('good')
  const [callQualityProfile, setCallQualityProfile] = useState<CallQualityProfile>('high')

  const callSignalsRef = useRef<CallSignal[]>([])
  const membraneClientRef = useRef<MembraneClient | null>(null)
  const membraneClientCallIdRef = useRef<string | null>(null)
  const membraneClientEndpointIdRef = useRef<string | null>(null)
  const membraneLocalTrackIdsRef = useRef<string[]>([])
  const membraneLocalTrackBindingsRef = useRef<LocalTrackBinding[]>([])
  const membraneOfferInitializedRef = useRef(false)
  const membraneIntegratedTurnSeenRef = useRef(false)
  const membranePendingTurnForRenegotiationRef = useRef(false)
  const membranePendingRemoteRenegotiationRef = useRef(false)
  const screenShareTrackIdsRef = useRef<string[]>([])
  const localMediaStreamRef = useRef<MediaStream | null>(null)
  const transportBootstrapRef = useRef<Promise<void> | null>(null)
  const attachLocalMediaInFlightRef = useRef<Promise<void> | null>(null)
  const membraneConnectRequestedCallIdRef = useRef<string | null>(null)
  const transportStateCallIdRef = useRef<string | null>(null)
  const activeCallScanInFlightRef = useRef(false)
  const activeCallApiBaseUrlRef = useRef(getDefaultApiBaseUrl())
  const mediaE2eeControllerRef = useRef<MediaE2eeController | null>(null)
  const groupCallKeyMaterialRef = useRef<string | null>(null)
  const groupCallKeyGeneratedForCallIdRef = useRef<string | null>(null)
  const groupCallKeyDistributedDeviceIdsRef = useRef<Record<string, string[]>>({})
  const directCallKeyMaterialRef = useRef<string | null>(null)
  const directCallKeyGeneratedForCallIdRef = useRef<string | null>(null)
  const syncTracksInFlightRef = useRef(false)
  const reconcileLocalTracksInFlightRef = useRef(false)
  const hiddenVideoTrackStateRef = useRef(new WeakMap<MediaStreamTrack, boolean>())
  const recentMembraneEventsRef = useRef<Map<string, number>>(new Map())
  const recentMembraneOfferDataAtRef = useRef<number | null>(null)
  const lastRealtimeMediaEventAtRef = useRef<number>(0)
  const reconnectStateRef = useRef<ReconnectLifecycleState>('idle')
  const reconnectAttemptRef = useRef(0)
  const reconnectScheduledTimerRef = useRef<number | null>(null)
  const reconnectStateResetTimerRef = useRef<number | null>(null)
  const reconnectStableAtRef = useRef<number | null>(null)
  const queuedMembraneEventsDuringReconnectRef = useRef<string[]>([])
  const queuedNonCriticalEventKeysDuringReconnectRef = useRef<Map<string, number>>(new Map())
  const recentRealtimeCriticalEventsRef = useRef<Map<string, number>>(new Map())
  const recentFailureContextsRef = useRef<Map<string, number>>(new Map())
  const localAudioMutedRef = useRef(true)
  const placeholderAudioCleanupRef = useRef<(() => void) | null>(null)
  const placeholderVideoCleanupRef = useRef<(() => void) | null>(null)
  const remoteStateThrottleTimerRef = useRef<number | null>(null)
  const remoteStatePendingPayloadRef = useRef<MembraneRemoteStatePayload | null>(null)
  const remoteStateLastAppliedAtRef = useRef(0)
  const callTransportStatusRef = useRef<CallTransportStatus>('connected')
  const callQualityProfileRef = useRef<CallQualityProfile>('high')
  const callQualityIndicatorRef = useRef<CallQualityIndicator>('good')
  const callQualityHysteresisRef = useRef<CallQualityHysteresisState>(DEFAULT_CALL_QUALITY_HYSTERESIS)
  const callQualityStatsSnapshotRef = useRef<{
    timestampMs: number
    inboundPacketsReceived: number
    inboundPacketsLost: number
    outboundBytesSent: number
    inboundBytesReceived: number
  } | null>(null)
  const callQualityAnnouncedProfileRef = useRef<CallQualityProfile | null>(null)
  const callTransportDisconnectedSinceRef = useRef<number | null>(null)

  useEffect(() => {
    callSignalsRef.current = callSignals
  }, [callSignals])

  useEffect(() => {
    callTransportStatusRef.current = callTransportStatus
  }, [callTransportStatus])

  useEffect(() => {
    callQualityProfileRef.current = callQualityProfile
  }, [callQualityProfile])

  useEffect(() => {
    callQualityIndicatorRef.current = callQualityIndicator
  }, [callQualityIndicator])

  const isVerboseCallDebugEnabled = useCallback((): boolean => {
    if (!CALL_DEBUG_ENABLED) {
      return false
    }

    let runtimeOverride: string | null = null
    if (typeof window !== 'undefined') {
      try {
        runtimeOverride = window.localStorage.getItem('vostok.call.debug')
      } catch {
        runtimeOverride = null
      }
    }

    return isCallDebugVerboseEnabled({
      dev: CALL_DEBUG_ENABLED,
      buildVerbose: CALL_DEBUG_VERBOSE_BUILD,
      runtimeOverride
    })
  }, [])

  const logCallDebug = useCallback((event: string, details?: Record<string, unknown>) => {
    if (!isVerboseCallDebugEnabled()) {
      return
    }

    const snapshot = {
      callId: activeCall?.id ?? null,
      membraneClientConnected,
      membraneOfferInitialized: membraneOfferInitializedRef.current,
      pc: getMembranePeerConnectionSnapshot(membraneClientRef.current)
    }

    console.log(`[call-debug] ${event}`, {
      ...snapshot,
      ...details
    })
  }, [activeCall?.id, isVerboseCallDebugEnabled, membraneClientConnected])

  const logCallFailure = useCallback((reason: string, details?: Record<string, unknown>) => {
    const now = Date.now()
    const key = `${activeCall?.id ?? 'none'}:${reason}`
    const previous = recentFailureContextsRef.current.get(key)
    if (previous != null && now - previous < 2_000) {
      return
    }

    recentFailureContextsRef.current.set(key, now)
    for (const [failureKey, seenAt] of recentFailureContextsRef.current) {
      if (now - seenAt > 15_000) {
        recentFailureContextsRef.current.delete(failureKey)
      }
    }

    console.warn('[call]', {
      reason,
      callId: activeCall?.id ?? null,
      ...details
    })
  }, [activeCall?.id])

  const clearReconnectTimers = useCallback(() => {
    if (reconnectScheduledTimerRef.current != null) {
      window.clearTimeout(reconnectScheduledTimerRef.current)
      reconnectScheduledTimerRef.current = null
    }

    if (reconnectStateResetTimerRef.current != null) {
      window.clearTimeout(reconnectStateResetTimerRef.current)
      reconnectStateResetTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearReconnectTimers()
    }
  }, [clearReconnectTimers])

  const setReconnectLifecycleState = useCallback((nextState: ReconnectLifecycleState) => {
    reconnectStateRef.current = nextState
    setReconnectState(nextState)
  }, [])

  const syncCallTransportStatus = useCallback((source: string) => {
    if (!activeCall || activeCall.status !== 'active' || isEndingCall) {
      callTransportDisconnectedSinceRef.current = null
      if (callTransportStatusRef.current !== 'connected') {
        const previousStatus = callTransportStatusRef.current
        callTransportStatusRef.current = 'connected'
        setCallTransportStatus('connected')
        logCallDebug('call-transport.transition', {
          source,
          previousStatus,
          nextStatus: 'connected',
          reconnectState: reconnectStateRef.current,
          membraneClientConnected,
          iceState: null,
          disconnectedDurationMs: 0
        })
      }
      return
    }

    const peerConnection = getMembranePeerConnection(membraneClientRef.current)
    const iceState = peerConnection?.iceConnectionState ?? null
    const nowWallTimeMs = Date.now()
    const disconnectedSignal =
      !membraneClientConnected ||
      reconnectStateRef.current === 'reconnecting' ||
      iceState === 'disconnected' ||
      iceState === 'failed' ||
      iceState === 'closed'

    if (disconnectedSignal) {
      if (callTransportDisconnectedSinceRef.current == null) {
        callTransportDisconnectedSinceRef.current = nowWallTimeMs
      }
    } else {
      callTransportDisconnectedSinceRef.current = null
    }

    const disconnectedDurationMs =
      callTransportDisconnectedSinceRef.current == null
        ? 0
        : Math.max(0, nowWallTimeMs - callTransportDisconnectedSinceRef.current)

    const nextStatus = deriveCallTransportStatus({
      reconnectState: reconnectStateRef.current,
      membraneClientConnected,
      iceState,
      disconnectedDurationMs
    })

    if (callTransportStatusRef.current === nextStatus) {
      return
    }

    const previousStatus = callTransportStatusRef.current
    callTransportStatusRef.current = nextStatus
    setCallTransportStatus(nextStatus)

    logCallDebug('call-transport.transition', {
      source,
      previousStatus,
      nextStatus,
      reconnectState: reconnectStateRef.current,
      membraneClientConnected,
      iceState,
      disconnectedDurationMs
    })

    logCallFailure(`call-transport-status:${previousStatus}->${nextStatus}`, {
      source,
      reconnectState: reconnectStateRef.current,
      membraneClientConnected,
      iceState,
      disconnectedDurationMs
    })
  }, [activeCall, isEndingCall, logCallDebug, logCallFailure, membraneClientConnected])

  const requestTransportReconnect = useEffectEvent((reason: string) => {
    if (!activeCall || activeCall.status !== 'active' || isEndingCall || view !== 'chat') {
      return
    }

    const now = Date.now()
    if (shouldResetReconnectAttempts(reconnectStableAtRef.current, now)) {
      reconnectAttemptRef.current = 0
    }

    if (
      reconnectStateRef.current === 'reconnecting' &&
      (reconnectScheduledTimerRef.current != null || transportBootstrapRef.current != null)
    ) {
      return
    }

    setReconnectLifecycleState('reconnecting')
    clearReconnectTimers()
    resetMembraneClient()
    membraneConnectRequestedCallIdRef.current = null

    const delayMs = nextReconnectDelayMs(reconnectAttemptRef.current)

    logCallDebug('membrane.reconnect.requested', {
      reason,
      reconnectAttempt: reconnectAttemptRef.current + 1,
      reconnectDelayMs: delayMs,
      ...buildLocalTrackDebugSnapshot()
    })

    logCallFailure('reconnect-requested', {
      reason,
      reconnectAttempt: reconnectAttemptRef.current + 1,
      reconnectDelayMs: delayMs
    })

    reconnectScheduledTimerRef.current = window.setTimeout(() => {
      reconnectScheduledTimerRef.current = null
      reconnectAttemptRef.current += 1
      setTransportReconnectVersion((current) => current + 1)
    }, delayMs)
  })

  const buildLocalTrackDebugSnapshot = useCallback(() => {
    const localStream = normalizeLocalStreamBindings(localMediaStreamRef.current)

    return {
      localAudioSource,
      localVideoSource,
      localTracks: (localStream?.getTracks() ?? []).map((track) => ({
        id: track.id,
        kind: track.kind,
        enabled: track.enabled,
        muted: track.muted,
        placeholder: isPlaceholderTrack(track)
      })),
      localBindings: membraneLocalTrackBindingsRef.current.map((binding) => ({
        trackId: binding.trackId,
        kind: binding.kind,
        mediaTrackId: binding.mediaTrackId,
        source: binding.source
      })),
      membraneLocalTracks: getMembraneLocalTrackSnapshots(membraneClientRef.current)
    }
  }, [localAudioSource, localVideoSource])

  const applyRemoteStateSnapshot = useCallback((payload: MembraneRemoteStatePayload) => {
    logCallDebug('membrane.remote-state', {
      endpointCount: payload.endpointCount,
      trackCount: payload.trackCount,
      readyAudioTrackCount: payload.readyAudioTrackCount,
      readyVideoTrackCount: payload.readyVideoTrackCount,
      tracks: payload.tracks.map((track) => ({
        id: track.id,
        endpointId: track.endpointId,
        kind: track.kind,
        source: track.source,
        ready: track.ready,
        mediaTrackId: track.mediaTrack?.id ?? null,
        voiceActivity: track.voiceActivity
      }))
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
    remoteStateLastAppliedAtRef.current = Date.now()
  }, [logCallDebug])

  const scheduleRemoteStateSnapshot = useCallback((payload: MembraneRemoteStatePayload) => {
    const elapsedMs = Date.now() - remoteStateLastAppliedAtRef.current

    if (elapsedMs >= REMOTE_STATE_THROTTLE_MS) {
      if (remoteStateThrottleTimerRef.current != null) {
        window.clearTimeout(remoteStateThrottleTimerRef.current)
        remoteStateThrottleTimerRef.current = null
      }
      remoteStatePendingPayloadRef.current = null
      applyRemoteStateSnapshot(payload)
      return
    }

    remoteStatePendingPayloadRef.current = payload

    if (remoteStateThrottleTimerRef.current != null) {
      return
    }

    const delayMs = Math.max(0, REMOTE_STATE_THROTTLE_MS - elapsedMs)
    remoteStateThrottleTimerRef.current = window.setTimeout(() => {
      remoteStateThrottleTimerRef.current = null
      const nextPayload = remoteStatePendingPayloadRef.current
      remoteStatePendingPayloadRef.current = null
      if (!nextPayload) {
        return
      }

      applyRemoteStateSnapshot(nextPayload)
    }, delayMs)
  }, [applyRemoteStateSnapshot])

  function resetTransportState() {
    setTurnCredentials(null)
    setTransportError(null)
    setIsEndingCall(false)
    transportBootstrapRef.current = null
    membraneConnectRequestedCallIdRef.current = null
    clearReconnectTimers()
    reconnectAttemptRef.current = 0
    reconnectStableAtRef.current = null
    queuedMembraneEventsDuringReconnectRef.current = []
    queuedNonCriticalEventKeysDuringReconnectRef.current.clear()
    recentRealtimeCriticalEventsRef.current.clear()
    if (remoteStateThrottleTimerRef.current != null) {
      window.clearTimeout(remoteStateThrottleTimerRef.current)
      remoteStateThrottleTimerRef.current = null
    }
    remoteStatePendingPayloadRef.current = null
    remoteStateLastAppliedAtRef.current = 0
    setReconnectLifecycleState('idle')
    setCallTransportStatus('connected')
    callTransportStatusRef.current = 'connected'
    setCallQualityIndicator('good')
    setCallQualityProfile('high')
    callQualityIndicatorRef.current = 'good'
    callQualityProfileRef.current = 'high'
    callQualityHysteresisRef.current = DEFAULT_CALL_QUALITY_HYSTERESIS
    callQualityStatsSnapshotRef.current = null
    callQualityAnnouncedProfileRef.current = null
    callTransportDisconnectedSinceRef.current = null
  }

  function resetMembraneClient() {
    void removeLocalTracksFromMembrane(membraneClientRef.current, membraneLocalTrackIdsRef.current)
    cleanupMembraneClient(membraneClientRef.current)
    membraneClientRef.current = null
    membraneClientCallIdRef.current = null
    membraneLocalTrackIdsRef.current = []
    membraneLocalTrackBindingsRef.current = []
    placeholderAudioCleanupRef.current?.()
    placeholderAudioCleanupRef.current = null
    placeholderVideoCleanupRef.current?.()
    placeholderVideoCleanupRef.current = null
    membraneOfferInitializedRef.current = false
    membraneIntegratedTurnSeenRef.current = false
    membranePendingTurnForRenegotiationRef.current = false
    membranePendingRemoteRenegotiationRef.current = false
    membraneConnectRequestedCallIdRef.current = null
    if (remoteStateThrottleTimerRef.current != null) {
      window.clearTimeout(remoteStateThrottleTimerRef.current)
      remoteStateThrottleTimerRef.current = null
    }
    remoteStatePendingPayloadRef.current = null
    remoteStateLastAppliedAtRef.current = 0
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
    membraneClientEndpointIdRef.current = null
  }

  function resetWebRtcLab() {
    resetTransportState()
    resetMembraneClient()
    mediaE2eeControllerRef.current?.teardown()
    mediaE2eeControllerRef.current = null
    groupCallKeyMaterialRef.current = null
    groupCallKeyGeneratedForCallIdRef.current = null
    groupCallKeyDistributedDeviceIdsRef.current = {}
    directCallKeyMaterialRef.current = null
    directCallKeyGeneratedForCallIdRef.current = null
    syncTracksInFlightRef.current = false
    hiddenVideoTrackStateRef.current = new WeakMap()
    recentMembraneEventsRef.current.clear()
    recentRealtimeCriticalEventsRef.current.clear()
    recentFailureContextsRef.current.clear()
    localAudioMutedRef.current = true
    placeholderVideoCleanupRef.current?.()
    placeholderVideoCleanupRef.current = null
    setMediaEncryptionState('disabled')
    setMediaEncryptionFingerprint(null)
    setCurrentKeyEpoch(null)

    stopLocalMediaStream(localMediaStreamRef.current)

    localMediaStreamRef.current = null
    setLocalMediaMode('none')
    setLocalAudioTrackCount(0)
    setLocalVideoTrackCount(0)
    setLocalAudioSource('none')
    setLocalVideoSource('none')
  }

  function normalizeMembraneEventKey(eventPayload: string): string {
    try {
      const parsed = JSON.parse(eventPayload) as unknown
      return JSON.stringify(sortMembraneEventValue(parsed))
    } catch {
      return eventPayload
    }
  }

  function sortMembraneEventValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(sortMembraneEventValue)
    }

    if (!value || typeof value !== 'object') {
      return value
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortMembraneEventValue(nestedValue)])
    )
  }

  function pruneRecentMembraneEvents(now: number): void {
    const recentEvents = recentMembraneEventsRef.current

    for (const [event, seenAt] of recentEvents) {
      if (now - seenAt > CALL_EVENT_DEDUPE_WINDOW_MS) {
        recentEvents.delete(event)
      }
    }
  }

  function pruneRecentRealtimeCriticalEvents(now: number): void {
    const recentEvents = recentRealtimeCriticalEventsRef.current

    for (const [event, seenAt] of recentEvents) {
      if (now - seenAt > CALL_REALTIME_EVENT_ARBITRATION_WINDOW_MS) {
        recentEvents.delete(event)
      }
    }
  }

  function pruneQueuedNonCriticalEvents(now: number): void {
    const queuedEventKeys = queuedNonCriticalEventKeysDuringReconnectRef.current

    for (const [event, seenAt] of queuedEventKeys) {
      if (now - seenAt > CALL_EVENT_DEDUPE_WINDOW_MS) {
        queuedEventKeys.delete(event)
      }
    }
  }

  function wasMembraneEventSeenRecently(event: string, now: number): boolean {
    const seenAt = recentMembraneEventsRef.current.get(normalizeMembraneEventKey(event))
    return seenAt != null && now - seenAt <= CALL_EVENT_DEDUPE_WINDOW_MS
  }

  function markMembraneEventSeen(event: string, now: number): void {
    recentMembraneEventsRef.current.set(normalizeMembraneEventKey(event), now)
  }

  function markRealtimeCriticalEventSeen(event: string, now: number): void {
    recentRealtimeCriticalEventsRef.current.set(normalizeMembraneEventKey(event), now)
  }

  function wasRealtimeCriticalEventSeenRecently(event: string, now: number): boolean {
    const seenAt = recentRealtimeCriticalEventsRef.current.get(normalizeMembraneEventKey(event))
    return shouldSkipPolledCriticalEvent(seenAt, now)
  }

  function readMembraneNegotiationEventKind(eventPayload: string): string | null {
    try {
      const parsed = JSON.parse(eventPayload) as {
        type?: unknown
        data?: {
          type?: unknown
          data?: {
            type?: unknown
            integratedTurnServers?: unknown
          }
        }
      }

      if (
        typeof parsed.data?.data?.type === 'string' &&
        parsed.data.data.type.length > 0
      ) {
        return parsed.data.data.type
      }

      if (
        typeof parsed.data?.type === 'string' &&
        parsed.data.type !== 'custom' &&
        parsed.data.type.length > 0
      ) {
        return parsed.data.type
      }

      if (Array.isArray(parsed.data?.data?.integratedTurnServers)) {
        return 'integratedTurnServers'
      }
    } catch {
      return null
    }

    return null
  }

  function summarizeMembraneEvent(eventPayload: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(eventPayload) as {
        type?: unknown
        data?: {
          type?: unknown
          id?: unknown
          endpointId?: unknown
          trackIds?: unknown
          data?: {
            type?: unknown
            integratedTurnServers?: unknown
          }
        }
      }

      const integratedTurnServers = Array.isArray(parsed.data?.data?.integratedTurnServers)
        ? parsed.data?.data?.integratedTurnServers.length
        : 0
      const trackIds = Array.isArray(parsed.data?.trackIds)
        ? parsed.data.trackIds.filter((trackId): trackId is string => typeof trackId === 'string')
        : []

      return {
        type: typeof parsed.type === 'string' ? parsed.type : null,
        nestedType: typeof parsed.data?.type === 'string' ? parsed.data.type : null,
        negotiationType: typeof parsed.data?.data?.type === 'string' ? parsed.data.data.type : null,
        endpointId: typeof parsed.data?.endpointId === 'string' ? parsed.data.endpointId : null,
        id: typeof parsed.data?.id === 'string' ? parsed.data.id : null,
        trackIds,
        integratedTurnServers
      }
    } catch {
      return {
        type: null,
        nestedType: null,
        negotiationType: null,
        endpointId: null,
        id: null,
        trackIds: [],
        integratedTurnServers: 0
      }
    }
  }

  function isRemoteMembraneMutationEvent(eventPayload: string): boolean {
    try {
      const parsed = JSON.parse(eventPayload) as {
        type?: unknown
        data?: {
          id?: unknown
          endpointId?: unknown
        }
      }

      if (parsed.type === 'tracksAdded' || parsed.type === 'tracksRemoved') {
        return typeof parsed.data?.endpointId === 'string' &&
          parsed.data.endpointId !== membraneClientEndpointIdRef.current
      }

      if (parsed.type === 'endpointAdded' || parsed.type === 'endpointRemoved') {
        return typeof parsed.data?.id === 'string' &&
          parsed.data.id !== membraneClientEndpointIdRef.current
      }
    } catch {
      return false
    }

    return false
  }

  function isPrivateIceServerUrl(url: string): boolean {
    return /^(stun|turn|turns):(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(url)
  }

  function isNoisyLocalIceAddress(address: string | null): boolean {
    if (!address) {
      return false
    }

    return (
      /^0\./.test(address) ||
      /^198\.(18|19)\./.test(address) ||
      /^169\.254\./.test(address) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)
    )
  }

  function shouldIgnoreIceCandidateError(event: RTCPeerConnectionIceErrorEvent): boolean {
    if (typeof window === 'undefined') {
      return false
    }

    const isLocalhost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

    if (!isLocalhost || event.errorCode !== 701 || !isPrivateIceServerUrl(event.url)) {
      return false
    }

    return event.address == null || isNoisyLocalIceAddress(event.address)
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

  const ensureSignalSessionForDevice = useCallback(async (deviceId: string): Promise<boolean> => {
    if (!sessionToken) {
      return false
    }

    const participant = callParticipants.find((entry) => entry.device_id === deviceId)
    const username =
      participant?.username ??
      (deviceId === storedDevice?.deviceId ? storedDevice.username : null)

    if (!username) {
      return false
    }

    const response = await fetchUserPrekeys(sessionToken, username)
    const matchingBundle = response.devices.find((bundle) => bundle.device_id === deviceId)
    const prekeyBundle = toSignalPrekeyBundle(matchingBundle)

    if (!storedDevice?.deviceId || !activeChatSummary?.serverId) {
      return false
    }
    const ctx: SignalContext = {
      serverId: activeChatSummary.serverId,
      localDeviceId: storedDevice.deviceId
    }
    return ensureSessionForDevice(ctx, deviceId, prekeyBundle)
  }, [activeChatSummary?.serverId, callParticipants, sessionToken, storedDevice?.deviceId, storedDevice?.username])

  const ensureSignalSessionsForDevices = useCallback(async (deviceIds: string[]): Promise<string[]> => {
    const readyDeviceIds: string[] = []

    for (const deviceId of deviceIds) {
      if (await ensureSignalSessionForDevice(deviceId)) {
        readyDeviceIds.push(deviceId)
      }
    }

    return readyDeviceIds
  }, [ensureSignalSessionForDevice])

  const syncLocalMediaState = useCallback((stream: MediaStream | null) => {
    const normalizedStream = normalizeLocalStreamBindings(stream)
    const audioTrackCount = normalizedStream?.getAudioTracks().length ?? 0
    const videoTrackCount = normalizedStream?.getVideoTracks().length ?? 0
    const audioTrack = normalizedStream?.getAudioTracks()[0] ?? null
    const videoTrack = normalizedStream?.getVideoTracks()[0] ?? null
    const resolveSource = (
      kind: 'audio' | 'video',
      track: MediaStreamTrack | null
    ): 'none' | 'browser' | 'placeholder' => {
      if (!track) {
        return 'none'
      }

      const exactBinding =
        membraneLocalTrackBindingsRef.current.find((binding) => {
          return binding.kind === kind && binding.mediaTrackId === track.id
        }) ?? null

      if (exactBinding) {
        return exactBinding.source
      }

      return isPlaceholderTrack(track) ? 'placeholder' : 'browser'
    }

    setLocalAudioTrackCount(audioTrackCount)
    setLocalVideoTrackCount(videoTrackCount)
    setLocalMediaMode(videoTrackCount > 0 ? 'audio_video' : audioTrackCount > 0 ? 'audio' : 'none')
    setLocalAudioSource(resolveSource('audio', audioTrack))
    setLocalVideoSource(resolveSource('video', videoTrack))
  }, [normalizeLocalStreamBindings])

  const applyLocalAudioMutePreference = useCallback((stream: MediaStream | null) => {
    if (!stream) {
      return
    }

    for (const track of stream.getAudioTracks()) {
      track.enabled = !localAudioMutedRef.current
    }
  }, [])

  const setLocalAudioMuted = useCallback((muted: boolean) => {
    localAudioMutedRef.current = muted
    applyLocalAudioMutePreference(localMediaStreamRef.current)
  }, [applyLocalAudioMutePreference])

  const createPlaceholderAudioTrack = useCallback((): MediaStreamTrack => {
    placeholderAudioCleanupRef.current?.()
    placeholderAudioCleanupRef.current = null

    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

    if (!AudioContextCtor) {
      throw new Error('AudioContext is unavailable for placeholder audio.')
    }

    const audioContext = new AudioContextCtor()
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const destination = audioContext.createMediaStreamDestination()

    oscillator.type = 'sine'
    gain.gain.value = 0
    oscillator.connect(gain)
    gain.connect(destination)
    oscillator.start()

    const track = destination.stream.getAudioTracks()[0]

    if (!track) {
      oscillator.stop()
      void audioContext.close().catch(() => undefined)
      throw new Error('Failed to create placeholder audio track.')
    }

    placeholderAudioCleanupRef.current = () => {
      try {
        oscillator.stop()
      } catch {
        // Already stopped.
      }
      void audioContext.close().catch(() => undefined)
    }

    return markPlaceholderTrack(track)
  }, [])

  const createPlaceholderVideoTrack = useCallback((): MediaStreamTrack => {
    placeholderVideoCleanupRef.current?.()
    placeholderVideoCleanupRef.current = null

    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const context = canvas.getContext('2d')

    if (!context || typeof canvas.captureStream !== 'function') {
      throw new Error('Canvas capture is unavailable for placeholder video.')
    }

    context.fillStyle = '#000000'
    context.fillRect(0, 0, canvas.width, canvas.height)

    const stream = canvas.captureStream(1)
    const track = stream.getVideoTracks()[0] ?? null

    if (!track) {
      throw new Error('Failed to create placeholder video track.')
    }

    placeholderVideoCleanupRef.current = () => {
      track.stop()
    }

    return markPlaceholderTrack(track)
  }, [])

  const attachTracksWithBindings = useCallback(async (
    client: MembraneClient,
    stream: MediaStream,
    tracks: MediaStreamTrack[]
  ): Promise<LocalTrackBinding[]> => {
    const bindings: LocalTrackBinding[] = []

    for (const track of tracks) {
      const source = isPlaceholderTrack(track) ? 'placeholder' : 'browser'
      const trackId = await attachLocalTrackToMembrane(client, track, stream, source)
      bindings.push({
        trackId,
        kind: track.kind as 'audio' | 'video',
        mediaTrackId: track.id,
        source
      })
    }

    return bindings
  }, [])

  function normalizeLocalStreamBindings(stream: MediaStream | null): MediaStream | null {
    if (!stream) {
      membraneLocalTrackIdsRef.current = []
      membraneLocalTrackBindingsRef.current = []
      return null
    }

    const membraneSnapshots = getMembraneLocalTrackSnapshots(membraneClientRef.current)
    const nextBindings: LocalTrackBinding[] = []

    for (const kind of ['audio', 'video'] as const) {
      const kindTracks = stream.getTracks().filter((track) => track.kind === kind)

      if (kindTracks.length > 1) {
        const rankedTracks = [...kindTracks].sort((left, right) => {
          const score = (track: MediaStreamTrack) => {
            const exactBinding = membraneLocalTrackBindingsRef.current.find((binding) => {
              return binding.kind === kind && binding.mediaTrackId === track.id
            })
            const exactSnapshot = membraneSnapshots.find((snapshot) => {
              return snapshot.kind === kind && snapshot.mediaTrackId === track.id
            })

            return (
              (exactBinding ? 100 : 0) +
              (exactSnapshot ? 80 : 0) +
              (isPlaceholderTrack(track) ? 0 : 40) +
              (track.enabled ? 10 : 0)
            )
          }

          return score(right) - score(left)
        })

        const preferredTrack = rankedTracks[0] ?? null

        for (const track of rankedTracks.slice(1)) {
          stream.removeTrack(track)
          if (track !== preferredTrack && track.readyState !== 'ended') {
            track.stop()
          }
        }
      }

      const activeTrack = stream.getTracks().find((track) => track.kind === kind) ?? null

      if (!activeTrack) {
        continue
      }

      const exactBinding =
        membraneLocalTrackBindingsRef.current.find((binding) => {
          return binding.kind === kind && binding.mediaTrackId === activeTrack.id
        }) ?? null
      const fallbackSnapshot =
        membraneSnapshots.find((snapshot) => {
          return snapshot.kind === kind && snapshot.mediaTrackId === activeTrack.id
        }) ??
        membraneSnapshots.find((snapshot) => {
          return (
            snapshot.kind === kind &&
            snapshot.source === (isPlaceholderTrack(activeTrack) ? 'placeholder' : 'browser')
          )
        }) ??
        membraneSnapshots.find((snapshot) => snapshot.kind === kind) ??
        null

      if (exactBinding) {
        nextBindings.push({
          ...exactBinding,
          mediaTrackId: activeTrack.id,
          source: isPlaceholderTrack(activeTrack) ? 'placeholder' : exactBinding.source
        })
        continue
      }

      if (fallbackSnapshot?.trackId) {
        nextBindings.push({
          trackId: fallbackSnapshot.trackId,
          kind,
          mediaTrackId: activeTrack.id,
          source:
            fallbackSnapshot.source === 'placeholder' || isPlaceholderTrack(activeTrack)
              ? 'placeholder'
              : 'browser'
        })
      }
    }

    membraneLocalTrackBindingsRef.current = nextBindings
    membraneLocalTrackIdsRef.current = nextBindings.map((binding) => binding.trackId)

    return stream
  }

  const ensureLocalSenderIntegrity = useEffectEvent(
    async (reason: string, allowRetry = true): Promise<void> => {
      const stream = normalizeLocalStreamBindings(localMediaStreamRef.current)
      const client = membraneClientRef.current

      if (!stream || !client) {
        return
      }

      const activeAudioTrack = stream.getAudioTracks()[0] ?? null
      const activeVideoTrack = stream.getVideoTracks()[0] ?? null

      let membraneSnapshots = getMembraneLocalTrackSnapshots(client)
      const { remove } = selectPrimaryLocalSenderTrackIds(membraneSnapshots, {
        audio: activeAudioTrack?.id ?? null,
        video: activeVideoTrack?.id ?? null
      })

      if (remove.length > 0) {
        await removeLocalTracksFromMembrane(client, remove)
        membraneSnapshots = getMembraneLocalTrackSnapshots(client)
      }

      const nextBindings: LocalTrackBinding[] = []

      for (const kind of ['audio', 'video'] as const) {
        const activeTrack = kind === 'audio' ? activeAudioTrack : activeVideoTrack
        if (!activeTrack) {
          continue
        }

        const source: LocalTrackBinding['source'] = isPlaceholderTrack(activeTrack)
          ? 'placeholder'
          : 'browser'
        const existingBinding =
          membraneLocalTrackBindingsRef.current.find((binding) => {
            return binding.kind === kind && binding.mediaTrackId === activeTrack.id
          }) ??
          membraneLocalTrackBindingsRef.current.find((binding) => {
            return binding.kind === kind
          }) ??
          null

        const snapshotByTrack =
          membraneSnapshots.find((snapshot) => {
            return snapshot.kind === kind && snapshot.mediaTrackId === activeTrack.id
          }) ??
          membraneSnapshots.find((snapshot) => snapshot.kind === kind) ??
          null

        let trackId =
          existingBinding?.trackId ??
          snapshotByTrack?.trackId ??
          findMembraneLocalTrackId(client, activeTrack, kind, source)

        if (!trackId && canMutateMembraneTracks(client)) {
          trackId = await attachLocalTrackToMembrane(client, activeTrack, stream, source)
        }

        if (!trackId) {
          continue
        }

        nextBindings.push({
          trackId,
          kind,
          mediaTrackId: activeTrack.id,
          source
        })
      }

      membraneLocalTrackBindingsRef.current = nextBindings
      membraneLocalTrackIdsRef.current = nextBindings.map((binding) => binding.trackId)
      syncLocalMediaState(stream)

      if (!allowRetry) {
        return
      }

      const latestSnapshots = getMembraneLocalTrackSnapshots(client)
      const latestSelection = selectPrimaryLocalSenderTrackIds(latestSnapshots, {
        audio: stream.getAudioTracks()[0]?.id ?? null,
        video: stream.getVideoTracks()[0]?.id ?? null
      })

      const hasDuplicateSenders = latestSelection.remove.length > 0
      const missingAudioBinding = Boolean(stream.getAudioTracks()[0] && !nextBindings.some((binding) => binding.kind === 'audio'))
      const missingVideoBinding = Boolean(stream.getVideoTracks()[0] && !nextBindings.some((binding) => binding.kind === 'video'))

      if (hasDuplicateSenders || missingAudioBinding || missingVideoBinding) {
        logCallDebug('local-sender-integrity.retry', {
          reason,
          hasDuplicateSenders,
          missingAudioBinding,
          missingVideoBinding,
          ...buildLocalTrackDebugSnapshot()
        })
        await ensureLocalSenderIntegrity(`${reason}:retry`, false)
      }
    }
  )

  const removeBoundLocalTracksByKind = useCallback(async (kind: 'audio' | 'video') => {
    const bindings = membraneLocalTrackBindingsRef.current.filter((binding) => binding.kind === kind)

    if (bindings.length === 0) {
      return
    }

    await removeLocalTracksFromMembrane(
      membraneClientRef.current,
      bindings.map((binding) => binding.trackId)
    )

    membraneLocalTrackBindingsRef.current = membraneLocalTrackBindingsRef.current.filter(
      (binding) => binding.kind !== kind
    )
    membraneLocalTrackIdsRef.current = membraneLocalTrackBindingsRef.current.map((binding) => binding.trackId)
  }, [])

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
        if (membraneClientRef.current !== client) {
          return
        }

        const filteredMediaEvent = filterOutgoingMembraneCandidateEvent(mediaEvent)

        if (!filteredMediaEvent) {
          return
        }

        if (filteredMediaEvent.includes('"renegotiateTracks"')) {
          membranePendingTurnForRenegotiationRef.current = true
        }

        void pushCallWebRtcMediaEvent(sessionToken, activeCallId, filteredMediaEvent)
          .then((response) => {
            setCallWebRtcEndpoint(response.endpoint)
          })
          .catch((err) => {
            logCallDebug('membrane.send-media-event.failed', {
              message: err instanceof Error ? err.message : String(err)
            })
            logCallFailure('send-media-event-failed', {
              message: err instanceof Error ? err.message : String(err)
            })
          })
      },
      onConnected(payload) {
        if (membraneClientRef.current !== client) {
          return
        }

        setTransportError(null)
        setMembraneClientConnected(true)
        reconnectStableAtRef.current = Date.now()
        const wasReconnecting = reconnectStateRef.current === 'reconnecting'
        setReconnectLifecycleState('stable')
        clearReconnectTimers()
        logCallDebug('membrane.connected', {
          endpointId: payload.endpointId,
          otherEndpointCount: payload.otherEndpointCount,
          reconnectRecovered: wasReconnecting,
          reconnectAttempt: reconnectAttemptRef.current,
          ...buildLocalTrackDebugSnapshot()
        })
        setMembraneClientEndpointId(payload.endpointId)
        membraneClientEndpointIdRef.current = payload.endpointId
        setMembraneRemoteEndpointCount(payload.otherEndpointCount)

        if (wasReconnecting) {
          logCallFailure('reconnect-recovered', {
            endpointId: payload.endpointId,
            reconnectAttempt: reconnectAttemptRef.current
          })
        }

        const queuedEvents = queuedMembraneEventsDuringReconnectRef.current
        queuedMembraneEventsDuringReconnectRef.current = []
        queuedNonCriticalEventKeysDuringReconnectRef.current.clear()
        if (queuedEvents.length > 0) {
          queueMicrotask(() => {
            handleMembraneQueueBatch(queuedEvents, 'replay')
          })
        }

        void ensureLocalSenderIntegrity('membrane-connected')

        reconnectStateResetTimerRef.current = window.setTimeout(() => {
          if (reconnectStateRef.current === 'stable') {
            setReconnectLifecycleState('idle')
          }
        }, 1_000)
      },
      onDisconnected() {
        const currentClient = membraneClientRef.current
        if (currentClient !== client) {
          logCallDebug('membrane.disconnected.stale-client', {
            endpointId: membraneClientEndpointIdRef.current
          })
          return
        }
        const peerConnection = getMembranePeerConnection(currentClient)
        const shouldIgnoreTransientDisconnect =
          activeCall?.status === 'active' &&
          !isEndingCall &&
          currentClient === client &&
          peerConnection != null &&
          peerConnection.signalingState !== 'closed' &&
          peerConnection.connectionState !== 'failed' &&
          peerConnection.connectionState !== 'closed' &&
          peerConnection.iceConnectionState !== 'failed' &&
          peerConnection.iceConnectionState !== 'closed'

        if (shouldIgnoreTransientDisconnect) {
          logCallDebug('membrane.disconnected.ignored', {
            endpointId: membraneClientEndpointIdRef.current,
            ...buildLocalTrackDebugSnapshot()
          })
          return
        }

        membraneConnectRequestedCallIdRef.current = null
        setMembraneClientConnected(false)
        logCallDebug('membrane.disconnected', {
          endpointId: membraneClientEndpointIdRef.current,
          ...buildLocalTrackDebugSnapshot()
        })
        setMembraneRemoteEndpointCount(0)
        setMembraneRemoteTrackCount(0)
        setMembraneReadyTrackCount(0)
        setMembraneReadyAudioTrackCount(0)
        setMembraneReadyVideoTrackCount(0)
        setMembraneRemoteEndpointIds([])
        setMembraneRemoteTrackIds([])
        setMembraneRemoteEndpoints([])
        setMembraneRemoteTracks([])
        requestTransportReconnect('disconnected')
      },
      onRemoteStateChange(payload) {
        if (membraneClientRef.current !== client) {
          return
        }

        scheduleRemoteStateSnapshot(payload)
      },
      onConnectionError(message) {
        if (membraneClientRef.current !== client) {
          return
        }

        const peerConnection = getMembranePeerConnection(client)
        const connectionState = peerConnection?.connectionState ?? null
        const iceConnectionState = peerConnection?.iceConnectionState ?? null
        const terminalFailure =
          connectionState === 'failed' ||
          connectionState === 'closed' ||
          iceConnectionState === 'failed' ||
          iceConnectionState === 'closed'

        membraneConnectRequestedCallIdRef.current = null
        logCallDebug('membrane.connection-error', {
          message,
          connectionState,
          iceConnectionState,
          terminalFailure,
          ...buildLocalTrackDebugSnapshot()
        })

        // Membrane can emit connectionError for transient negotiations.
        // Reconnect only when the underlying PeerConnection is in a terminal state.
        if (!terminalFailure) {
          logCallDebug('membrane.connection-error.ignored', {
            message,
            connectionState,
            iceConnectionState
          })
          return
        }

        logCallFailure('connection-error', {
          message,
          connectionState,
          iceConnectionState,
          ...buildLocalTrackDebugSnapshot()
        })
        setMembraneClientConnected(false)
        setTransportError(message)
        setBanner({
          tone: 'error',
          message: `Membrane WebRTC client error: ${message}`
        })
        requestTransportReconnect(`connection-error:${message}`)
      }
    })

    membraneClientRef.current = client
    membraneClientCallIdRef.current = activeCallId
    membraneLocalTrackIdsRef.current = []
    membraneLocalTrackBindingsRef.current = []
    membraneOfferInitializedRef.current = false
    membraneIntegratedTurnSeenRef.current = false
    membranePendingTurnForRenegotiationRef.current = false
    membranePendingRemoteRenegotiationRef.current = false
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
    membraneClientEndpointIdRef.current = deviceId

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

  const handleRealtimeCallMediaEvent = useEffectEvent(
    (payload: { callId: string; targetDeviceId: string; event: string }) => {
      if (
        !activeCall ||
        payload.callId !== activeCall.id ||
        !localDeviceId ||
        payload.targetDeviceId !== localDeviceId
      ) {
        return
      }

      lastRealtimeMediaEventAtRef.current = Date.now()
      handleMembraneQueueBatch([payload.event], 'realtime')
    }
  )

  const handleRealtimeCallSubscriptionError = useEffectEvent(() => {
    setBanner({
      tone: 'error',
      message: 'Realtime call subscription failed. Manual call refresh is still available.'
    })
  })

  const handleMembraneQueueBatch = useEffectEvent((events: string[], source: MembraneQueueSource = 'realtime') => {
    if (events.length === 0) {
      return
    }

    const now = Date.now()
    pruneRecentMembraneEvents(now)
    pruneRecentRealtimeCriticalEvents(now)
    pruneQueuedNonCriticalEvents(now)

    if (reconnectStateRef.current === 'reconnecting') {
      for (const event of events) {
        const negotiationEventKind = readMembraneNegotiationEventKind(event)
        const isCriticalNegotiationEvent = shouldBypassMembraneEventDedupe(negotiationEventKind)

        if (!isCriticalNegotiationEvent) {
          const normalizedEventKey = normalizeMembraneEventKey(event)
          const seenAt = queuedNonCriticalEventKeysDuringReconnectRef.current.get(normalizedEventKey)
          if (seenAt != null && now - seenAt <= CALL_EVENT_DEDUPE_WINDOW_MS) {
            continue
          }

          queuedNonCriticalEventKeysDuringReconnectRef.current.set(normalizedEventKey, now)
        } else {
          if (source === 'poll' && wasRealtimeCriticalEventSeenRecently(event, now)) {
            continue
          }

          if (source !== 'poll') {
            markRealtimeCriticalEventSeen(event, now)
          }
        }

        queuedMembraneEventsDuringReconnectRef.current.push(event)
      }

      if (queuedMembraneEventsDuringReconnectRef.current.length > CALL_RECONNECT_EVENT_QUEUE_LIMIT) {
        queuedMembraneEventsDuringReconnectRef.current =
          queuedMembraneEventsDuringReconnectRef.current.slice(-CALL_RECONNECT_EVENT_QUEUE_LIMIT)
      }
      return
    }

    let allowedPendingIntegratedTurn = false
    const freshEvents = events.filter((event) => {
      const negotiationEventKind = readMembraneNegotiationEventKind(event)
      const isCriticalNegotiationEvent = shouldBypassMembraneEventDedupe(negotiationEventKind)

      if (isCriticalNegotiationEvent) {
        if (source === 'poll' && wasRealtimeCriticalEventSeenRecently(event, now)) {
          logCallDebug('membrane.event.skipped', {
            reason: 'poll-duplicate-critical-event',
            ...summarizeMembraneEvent(event)
          })
          return false
        }

        if (source !== 'poll') {
          markRealtimeCriticalEventSeen(event, now)
        }

        return true
      }

      const shouldAllowPendingIntegratedTurn =
        negotiationEventKind === 'integratedTurnServers' &&
        membranePendingTurnForRenegotiationRef.current &&
        !allowedPendingIntegratedTurn

      if (shouldAllowPendingIntegratedTurn) {
        allowedPendingIntegratedTurn = true
        return true
      }

      return !wasMembraneEventSeenRecently(event, now)
    })

    if (freshEvents.length === 0) {
      return
    }

    setCallWebRtcMediaEvents((current) => [[...freshEvents].reverse(), current].flat().slice(0, 8))

    const nativeEvents = freshEvents.filter((eventPayload) => readMembraneNativeEventType(eventPayload) !== null)

    const nativeEventSet = new Set(nativeEvents)

    for (const eventPayload of freshEvents) {
      if (!nativeEventSet.has(eventPayload)) {
        markMembraneEventSeen(eventPayload, now)
      }
    }

    if (nativeEvents.length > 0 && membraneClientRef.current) {
      for (const eventPayload of nativeEvents) {
        try {
          const isIntegratedTurnEvent = eventPayload.includes('"integratedTurnServers"')
          const negotiationEventKind = readMembraneNegotiationEventKind(eventPayload)
          const peerConnection = getMembranePeerConnection(membraneClientRef.current)
          const eventSummary = summarizeMembraneEvent(eventPayload)
          const isOfferDataEvent =
            negotiationEventKind === 'offerData' || eventSummary.nestedType === 'offerData'

          if (isOfferDataEvent) {
            recentMembraneOfferDataAtRef.current = now
          }

          logCallDebug('membrane.event.received', {
            ...eventSummary,
            localEndpointId: membraneClientEndpointIdRef.current
          })

          if (negotiationEventKind === 'answer' && peerConnection?.signalingState === 'stable') {
            logCallDebug('membrane.event.skipped', {
              reason: 'stable-answer',
              ...eventSummary,
              localEndpointId: membraneClientEndpointIdRef.current
            })
            markMembraneEventSeen(eventPayload, now)
            continue
          }

          if (isIntegratedTurnEvent && !isOfferDataEvent) {
            const peerConnectionHealthy =
              peerConnection?.connectionState === 'connected' &&
              peerConnection?.iceConnectionState === 'connected'
            const shouldAllowIntegratedTurn =
              !membraneIntegratedTurnSeenRef.current ||
              membranePendingTurnForRenegotiationRef.current ||
              membranePendingRemoteRenegotiationRef.current ||
              !peerConnectionHealthy

            if (!shouldAllowIntegratedTurn) {
              logCallDebug('membrane.event.skipped', {
                reason: 'integrated-turn-not-needed',
                ...eventSummary,
                localEndpointId: membraneClientEndpointIdRef.current
              })
              markMembraneEventSeen(eventPayload, now)
              continue
            }

            membraneIntegratedTurnSeenRef.current = true
          }

          if (shouldSkipStaleMembraneMediaEvent(membraneClientRef.current, eventPayload)) {
            logCallDebug('membrane.event.skipped', {
              reason: 'stale-media-event',
              ...eventSummary,
              localEndpointId: membraneClientEndpointIdRef.current
            })
            markMembraneEventSeen(eventPayload, now)
            continue
          }

          const looksLikeStaleLocalDisconnect =
            eventSummary.type === 'endpointRemoved' &&
            eventSummary.id === membraneClientEndpointIdRef.current &&
            activeCall?.status === 'active' &&
            !isEndingCall &&
            (
              peerConnection?.connectionState === 'connected' ||
              peerConnection?.iceConnectionState === 'connected' ||
              (
                recentMembraneOfferDataAtRef.current != null &&
                now - recentMembraneOfferDataAtRef.current <= 5_000 &&
                peerConnection?.connectionState !== 'failed' &&
                peerConnection?.iceConnectionState !== 'failed' &&
                peerConnection?.signalingState === 'stable'
              )
            )

          if (looksLikeStaleLocalDisconnect) {
            logCallDebug('membrane.event.skipped', {
              reason: 'stale-local-endpoint-removed',
              ...eventSummary,
              localEndpointId: membraneClientEndpointIdRef.current
            })
            markMembraneEventSeen(eventPayload, now)
            continue
          }

          receiveMembraneMediaEvent(membraneClientRef.current, eventPayload)
          membraneOfferInitializedRef.current = true
          markMembraneEventSeen(eventPayload, now)

          if (isRemoteMembraneMutationEvent(eventPayload)) {
            membranePendingRemoteRenegotiationRef.current = true
          }

          if (negotiationEventKind === 'answer') {
            membranePendingTurnForRenegotiationRef.current = false
            membranePendingRemoteRenegotiationRef.current = false
          }
        } catch (err) {
          const summary = summarizeMembraneEvent(eventPayload)
          logCallDebug('membrane.receive-media-event.failed', {
            message: err instanceof Error ? err.message : String(err),
            ...summary
          })
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
          // Only set endpoint from snapshot if it exists — avoid overwriting
          // a valid endpoint from bootstrap with a stale not-yet-provisioned state.
          if (snapshot.endpoint?.exists) {
            setCallWebRtcEndpoint(snapshot.endpoint)
          }
        }
      } catch {
        if (!cancelled) {
          setCallParticipants([])
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
      setTurnCredentials(result.turnCredentials)
      if (result.participants) {
        setCallParticipants(result.participants)
      }
      setCallRoom(result.room)
      setCallWebRtcEndpoint(result.endpoint)
      membraneConnectRequestedCallIdRef.current = result.membraneConnectRequestedCallId
    })()
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : 'Failed to initialize direct call transport.'
        logCallDebug('transport.bootstrap.failed', {
          message
        })
        logCallFailure('transport-bootstrap-failed', {
          message
        })
        setTransportError(message)
        setBanner({ tone: 'error', message })
        requestTransportReconnect(`bootstrap-failed:${message}`)
      })
      .finally(() => {
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
    }) || isEndingCall) {
      return
    }

    void bootstrapDirectCallTransport()
  // bootstrapDirectCallTransport is a useEffectEvent — it reads current state
  // internally, so only true triggers (call identity, auth, view) belong here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeCall?.id,
    activeCall?.status,
    isEndingCall,
    sessionToken,
    storedDevice?.deviceId,
    transportReconnectVersion,
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

  // Poll Membrane WebRTC endpoint for media events.
  // Deps intentionally exclude callWebRtcEndpoint to prevent restart loops —
  // the poll itself updates endpoint state, which would tear down the interval.
  const callWebRtcEndpointExistsRef = useRef(false)
  useEffect(() => {
    callWebRtcEndpointExistsRef.current = Boolean(callWebRtcEndpoint?.exists)
  }, [callWebRtcEndpoint?.exists])

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active' || !sessionToken || view !== 'chat') {
      return
    }

    const token2 = sessionToken
    const callId = activeCall.id
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
          if (response.endpoint.exists) {
            callWebRtcEndpointExistsRef.current = true
            setCallWebRtcEndpoint(response.endpoint)
          }
          const hasRecentRealtimeMediaEvent =
            Date.now() - lastRealtimeMediaEventAtRef.current <= 3_000

          if (!hasRecentRealtimeMediaEvent) {
            handleMembraneQueueBatch(response.mediaEvents, 'poll')
          }
        }
      } catch {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall?.id, activeCall?.status, sessionToken, view])

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active' || !membraneClientConnected) {
      return
    }

    const peerConnection = getMembranePeerConnection(membraneClientRef.current)

    if (!peerConnection) {
      return
    }

    const logPeerConnectionState = (event: string) => {
      logCallDebug(`pc.${event}`, {
        ...buildLocalTrackDebugSnapshot(),
        pc: getMembranePeerConnectionSnapshot(membraneClientRef.current)
      })
    }

    logPeerConnectionState('snapshot')
    const handleConnectionStateChange = () => logPeerConnectionState('connectionstatechange')
    const handleIceConnectionStateChange = () => logPeerConnectionState('iceconnectionstatechange')
    const handleSignalingStateChange = () => logPeerConnectionState('signalingstatechange')

    peerConnection.addEventListener('connectionstatechange', handleConnectionStateChange)
    peerConnection.addEventListener('iceconnectionstatechange', handleIceConnectionStateChange)
    peerConnection.addEventListener('signalingstatechange', handleSignalingStateChange)

    return () => {
      peerConnection.removeEventListener('connectionstatechange', handleConnectionStateChange)
      peerConnection.removeEventListener('iceconnectionstatechange', handleIceConnectionStateChange)
      peerConnection.removeEventListener('signalingstatechange', handleSignalingStateChange)
    }
  }, [activeCall, buildLocalTrackDebugSnapshot, logCallDebug, membraneClientConnected])

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active' || !membraneClientConnected) {
      return
    }

    const localStream = localMediaStreamRef.current

    if (!localStream || membraneLocalTrackBindingsRef.current.length > 0) {
      return
    }

    const membraneLocalTracks = getMembraneLocalTrackSnapshots(membraneClientRef.current)

    if (membraneLocalTracks.length === 0) {
      return
    }

    syncLocalMediaState(localStream)
  }, [activeCall, localAudioSource, localVideoSource, membraneClientConnected, syncLocalMediaState])

  // ICE recovery — only tear down on hard failures.
  // In local development the browser can sit in `disconnected` while
  // renegotiation and connectivity checks are still converging; forcing
  // a reconnect from that transient state creates a permanent restart loop.
  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active' || !membraneClientConnected) return

    const pc = getMembranePeerConnection(membraneClientRef.current)
    if (!pc) return
    const peerConnection = pc

    function requestReconnect() {
      requestTransportReconnect('ice-failed')
    }

    function handleIceStateChange() {
      const state = peerConnection.iceConnectionState
      syncCallTransportStatus('pc-ice-state')

      if (state === 'failed') {
        requestReconnect()
      }
    }

    function handleConnectionStateChange() {
      syncCallTransportStatus('pc-connection-state')

      if (peerConnection.connectionState === 'failed') {
        requestTransportReconnect('pc-connection-failed')
      }
    }

    peerConnection.addEventListener('iceconnectionstatechange', handleIceStateChange)
    peerConnection.addEventListener('connectionstatechange', handleConnectionStateChange)

    return () => {
      peerConnection.removeEventListener('iceconnectionstatechange', handleIceStateChange)
      peerConnection.removeEventListener('connectionstatechange', handleConnectionStateChange)
    }
  }, [activeCall, membraneClientConnected, requestTransportReconnect, syncCallTransportStatus])

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active' || !membraneClientConnected) {
      return
    }

    const pc = getMembranePeerConnection(membraneClientRef.current)
    if (!pc) {
      return
    }

    const peerConnection = pc
    const previousHandler = peerConnection.onicecandidateerror

    peerConnection.onicecandidateerror = (event) => {
      if (shouldIgnoreIceCandidateError(event)) {
        return
      }

      if (typeof previousHandler === 'function') {
        previousHandler.call(peerConnection, event)
        return
      }

      logCallDebug('pc.icecandidateerror', {
        errorCode: event.errorCode,
        errorText: event.errorText,
        url: event.url,
        address: event.address,
        port: event.port,
        hostCandidate: (event as RTCPeerConnectionIceErrorEvent & { hostCandidate?: string | null }).hostCandidate ?? null
      })
    }

    return () => {
      if (peerConnection.onicecandidateerror === null || peerConnection.onicecandidateerror === previousHandler) {
        return
      }

      peerConnection.onicecandidateerror = previousHandler
    }
  }, [activeCall, membraneClientConnected])

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active') {
      callTransportDisconnectedSinceRef.current = null
      if (callTransportStatusRef.current !== 'connected') {
        callTransportStatusRef.current = 'connected'
        setCallTransportStatus('connected')
      }
      return
    }

    syncCallTransportStatus('transport-bootstrap')
    const intervalId = window.setInterval(() => {
      syncCallTransportStatus('transport-poll')
    }, 1_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [activeCall, reconnectState, membraneClientConnected, syncCallTransportStatus, transportReconnectVersion])

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active' || !membraneClientConnected) {
      callQualityStatsSnapshotRef.current = null
      callQualityHysteresisRef.current = DEFAULT_CALL_QUALITY_HYSTERESIS
      return
    }

    let cancelled = false

    const pollQuality = async () => {
      const peerConnection = getMembranePeerConnection(membraneClientRef.current)

      if (!peerConnection || cancelled) {
        return
      }

      const iceState = peerConnection.iceConnectionState ?? null
      const currentProfile = callQualityProfileRef.current

      try {
        const stats = await peerConnection.getStats()

        let inboundBytesReceived = 0
        let inboundPacketsReceived = 0
        let inboundPacketsLost = 0
        let outboundBytesSent = 0
        let jitterSeconds: number | null = null
        let jitterSamples = 0
        let rttSeconds: number | null = null
        let availableOutgoingBitrate: number | null = null
        let qualityLimitationReason: string | null = null

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp') {
            inboundBytesReceived += report.bytesReceived ?? 0
            inboundPacketsReceived += report.packetsReceived ?? 0
            inboundPacketsLost += report.packetsLost ?? 0

            if (typeof report.jitter === 'number') {
              const aggregateJitter = (jitterSeconds ?? 0) + report.jitter
              jitterSamples += 1
              jitterSeconds = aggregateJitter
            }
          }

          if (report.type === 'outbound-rtp') {
            outboundBytesSent += report.bytesSent ?? 0

            if (!qualityLimitationReason && typeof report.qualityLimitationReason === 'string') {
              qualityLimitationReason = report.qualityLimitationReason
            }
          }

          if (report.type === 'remote-inbound-rtp' && typeof report.roundTripTime === 'number') {
            rttSeconds = report.roundTripTime
          }

          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (typeof report.currentRoundTripTime === 'number' && rttSeconds === null) {
              rttSeconds = report.currentRoundTripTime
            }

            if (typeof report.availableOutgoingBitrate === 'number') {
              availableOutgoingBitrate = report.availableOutgoingBitrate
            }
          }
        })

        if (jitterSeconds !== null && jitterSamples > 0) {
          jitterSeconds = jitterSeconds / jitterSamples
        }

        const nowMs = performance.now()
        const previous = callQualityStatsSnapshotRef.current
        let packetLossRate = 0
        let outgoingBitrateBps: number | null = null
        let incomingBitrateBps: number | null = null

        if (previous) {
          const deltaSeconds = Math.max(0.001, (nowMs - previous.timestampMs) / 1000)
          const deltaPackets =
            (inboundPacketsReceived + inboundPacketsLost) -
            (previous.inboundPacketsReceived + previous.inboundPacketsLost)
          const deltaLost = inboundPacketsLost - previous.inboundPacketsLost

          if (deltaPackets > 0) {
            packetLossRate = Math.max(0, deltaLost) / deltaPackets
          }

          outgoingBitrateBps = Math.max(0, (outboundBytesSent - previous.outboundBytesSent) * 8 / deltaSeconds)
          incomingBitrateBps = Math.max(0, (inboundBytesReceived - previous.inboundBytesReceived) * 8 / deltaSeconds)
        }

        callQualityStatsSnapshotRef.current = {
          timestampMs: nowMs,
          inboundPacketsReceived,
          inboundPacketsLost,
          outboundBytesSent,
          inboundBytesReceived
        }

        const recommendedProfile = recommendCallQualityProfile({
          packetLossRate,
          rttSeconds,
          jitterSeconds,
          availableOutgoingBitrate,
          qualityLimitationReason,
          iceState
        })

        const decision = chooseCallQualityProfileWithHysteresis(
          currentProfile,
          recommendedProfile,
          callQualityHysteresisRef.current
        )

        callQualityHysteresisRef.current = decision.hysteresis

        if (decision.transition) {
          await applyCallQualityProfileToPeerConnection(peerConnection, decision.profile)

          if (cancelled) {
            return
          }

          callQualityProfileRef.current = decision.profile
          setCallQualityProfile(decision.profile)

          if (callQualityAnnouncedProfileRef.current !== decision.profile) {
            const message =
              decision.transition.direction === 'downgrade'
                ? decision.profile === 'audio_fallback'
                  ? 'Network is unstable. Switching to audio-priority mode for call stability.'
                  : `Network is constrained. Switching to ${describeCallQualityProfile(decision.profile)}.`
                : `Network recovered. Switching back to ${describeCallQualityProfile(decision.profile)}.`

            setBanner({ tone: 'info', message })
            callQualityAnnouncedProfileRef.current = decision.profile
          }

          logCallDebug('call-quality.transition', {
            previousProfile: decision.transition.previousProfile,
            nextProfile: decision.transition.nextProfile,
            direction: decision.transition.direction,
            packetLossRate,
            rttSeconds,
            jitterSeconds,
            availableOutgoingBitrate,
            qualityLimitationReason,
            iceState
          })

          logCallFailure(
            `call-quality-profile:${decision.transition.previousProfile}->${decision.transition.nextProfile}`,
            {
              direction: decision.transition.direction,
              packetLossRate,
              rttSeconds,
              jitterSeconds,
              availableOutgoingBitrate,
              qualityLimitationReason,
              iceState
            }
          )
        }

        const effectiveProfile = decision.profile
        const nextIndicator = deriveCallQualityIndicator(effectiveProfile)

        if (callQualityIndicatorRef.current !== nextIndicator) {
          const previousIndicator = callQualityIndicatorRef.current
          callQualityIndicatorRef.current = nextIndicator

          logCallDebug('call-quality-indicator.transition', {
            previousIndicator,
            nextIndicator,
            profile: effectiveProfile,
            packetLossRate,
            rttSeconds,
            jitterSeconds,
            availableOutgoingBitrate,
            outgoingBitrateBps,
            incomingBitrateBps,
            qualityLimitationReason,
            iceState
          })

          logCallFailure(`call-quality-indicator:${previousIndicator}->${nextIndicator}`, {
            profile: effectiveProfile,
            packetLossRate,
            rttSeconds,
            jitterSeconds,
            availableOutgoingBitrate,
            outgoingBitrateBps,
            incomingBitrateBps,
            qualityLimitationReason,
            iceState
          })
        }

        setCallQualityIndicator(nextIndicator)

        logCallDebug('call-quality.snapshot', {
          profile: effectiveProfile,
          recommendedProfile,
          packetLossRate,
          rttSeconds,
          jitterSeconds,
          availableOutgoingBitrate,
          outgoingBitrateBps,
          incomingBitrateBps,
          qualityLimitationReason,
          iceState,
          indicator: nextIndicator
        })
      } catch (error) {
        logCallDebug('call-quality.poll.error', {
          message: error instanceof Error ? error.message : String(error),
          iceState
        })
      }
    }

    const intervalId = window.setInterval(() => {
      void pollQuality()
    }, 2_000)

    void pollQuality()

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeCall, membraneClientConnected, logCallDebug, logCallFailure, setBanner])

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active' || !membraneClientConnected) {
      return
    }

    const peerConnection = getMembranePeerConnection(membraneClientRef.current)
    if (!peerConnection) {
      return
    }

    void applyCallQualityProfileToPeerConnection(peerConnection, callQualityProfileRef.current)
  }, [activeCall, membraneClientConnected, localAudioTrackCount, localVideoTrackCount, transportReconnectVersion])

  // Attach local tracks to Membrane
  useEffect(() => {
    if (syncTracksInFlightRef.current) {
      return
    }

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
      syncTracksInFlightRef.current = true
      try {
        const bindings = await attachTracksWithBindings(
          currentMembraneClient,
          currentLocalStream,
          currentLocalStream.getTracks()
        )

        if (!cancelled) {
          membraneLocalTrackBindingsRef.current = bindings
          membraneLocalTrackIdsRef.current = bindings.map((binding) => binding.trackId)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        // "already added to peerConnection" means the track was attached by
        // replaceLocalMediaStream during a prior bootstrap cycle. This is
        // expected — the tracks are flowing, we just missed capturing IDs.
        if (!errorMessage.includes('already added')) {
          if (!cancelled) {
            setBanner({ tone: 'error', message: errorMessage })
          }
        }
      } finally {
        syncTracksInFlightRef.current = false
      }
    }

    void syncTracks()

    return () => {
      cancelled = true
    }
  }, [activeCall, localAudioTrackCount, localVideoTrackCount, membraneClientConnected, sessionToken, setBanner, view])

  useEffect(() => {
    if (reconcileLocalTracksInFlightRef.current || attachLocalMediaInFlightRef.current) {
      return
    }

    if (!activeCall || activeCall.status !== 'active' || !membraneClientConnected || !membraneOfferInitializedRef.current) {
      return
    }

    const client = membraneClientRef.current
    const stream = localMediaStreamRef.current

    if (!client || !stream || !canMutateMembraneTracks(client)) {
      return
    }

    const activeClient = client
    const activeStream = stream

    const currentAudioTrack = activeStream.getAudioTracks()[0] ?? null
    const currentVideoTrack = activeStream.getVideoTracks()[0] ?? null
    const currentAudioSource: LocalTrackBinding['source'] =
      currentAudioTrack && isPlaceholderTrack(currentAudioTrack) ? 'placeholder' : 'browser'
    const currentVideoSource: LocalTrackBinding['source'] =
      currentVideoTrack && isPlaceholderTrack(currentVideoTrack) ? 'placeholder' : 'browser'
    const audioBinding = membraneLocalTrackBindingsRef.current.find((binding) => binding.kind === 'audio') ?? null
    const videoBinding = membraneLocalTrackBindingsRef.current.find((binding) => binding.kind === 'video') ?? null

    const shouldRecoverAudioBinding = Boolean(currentAudioTrack && currentAudioSource === 'browser' && !audioBinding)
    const shouldRecoverVideoBinding = Boolean(currentVideoTrack && currentVideoSource === 'browser' && !videoBinding)

    const needsAudioSync = Boolean(
      currentAudioTrack && (
        shouldRecoverAudioBinding ||
        (audioBinding !== null && (
          audioBinding.mediaTrackId !== currentAudioTrack.id ||
          audioBinding.source !== currentAudioSource
        ))
      )
    )

    const needsVideoSync = Boolean(
      currentVideoTrack && (
        shouldRecoverVideoBinding ||
        (videoBinding !== null && (
          videoBinding.mediaTrackId !== currentVideoTrack.id ||
          videoBinding.source !== currentVideoSource
        ))
      )
    )

    if (!needsAudioSync && !needsVideoSync) {
      return
    }

    logCallDebug('local-media.reconcile.request', {
      needsAudioSync,
      needsVideoSync,
      ...buildLocalTrackDebugSnapshot()
    })

    let cancelled = false

    async function reconcileLocalTracks() {
      reconcileLocalTracksInFlightRef.current = true

      try {
        if (currentAudioTrack) {
          if (audioBinding) {
            if (audioBinding.mediaTrackId !== currentAudioTrack.id || audioBinding.source !== currentAudioSource) {
              await replaceLocalTrackInMembrane(
                activeClient,
                audioBinding.trackId,
                currentAudioTrack,
                { kind: 'audio', source: currentAudioSource }
              )
              audioBinding.mediaTrackId = currentAudioTrack.id
              audioBinding.source = currentAudioSource
            }
          } else if (currentAudioSource === 'browser') {
            const recoveredTrackId =
              findMembraneLocalTrackId(activeClient, currentAudioTrack, 'audio', currentAudioSource)
            const trackId = recoveredTrackId ?? await attachLocalTrackToMembrane(
              activeClient,
              currentAudioTrack,
              activeStream,
              currentAudioSource
            )
            membraneLocalTrackBindingsRef.current = [
              ...membraneLocalTrackBindingsRef.current,
              {
                trackId,
                kind: 'audio',
                mediaTrackId: currentAudioTrack.id,
                source: currentAudioSource
              }
            ]
          } else {
            logCallDebug('local-media.reconcile.defer', {
              kind: 'audio',
              reason: 'placeholder-without-binding',
              ...buildLocalTrackDebugSnapshot()
            })
          }
        }

        const effectiveVideoTrack = currentVideoTrack
        const effectiveVideoSource = currentVideoSource

        if (effectiveVideoTrack) {
          if (videoBinding) {
            if (videoBinding.mediaTrackId !== effectiveVideoTrack.id || videoBinding.source !== effectiveVideoSource) {
              await replaceLocalTrackInMembrane(
                activeClient,
                videoBinding.trackId,
                effectiveVideoTrack,
                { kind: 'video', source: effectiveVideoSource }
              )
              videoBinding.mediaTrackId = effectiveVideoTrack.id
              videoBinding.source = effectiveVideoSource
            }
          } else {
            if (effectiveVideoSource === 'placeholder') {
              logCallDebug('local-media.reconcile.defer', {
                kind: 'video',
                reason: 'placeholder-without-binding',
                ...buildLocalTrackDebugSnapshot()
              })
            } else {
              const recoveredTrackId =
                findMembraneLocalTrackId(activeClient, effectiveVideoTrack, 'video', effectiveVideoSource)
              const trackId = recoveredTrackId ?? await attachLocalTrackToMembrane(
                activeClient,
                effectiveVideoTrack,
                activeStream,
                effectiveVideoSource
              )
              membraneLocalTrackBindingsRef.current = [
                ...membraneLocalTrackBindingsRef.current,
                {
                  trackId,
                  kind: 'video',
                  mediaTrackId: effectiveVideoTrack.id,
                  source: effectiveVideoSource
                }
              ]
            }
          }
        }

        membraneLocalTrackIdsRef.current = membraneLocalTrackBindingsRef.current.map((binding) => binding.trackId)

        if (!cancelled) {
          syncLocalMediaState(activeStream)
          await ensureLocalSenderIntegrity('reconcile-local-tracks')
          logCallDebug('local-media.reconcile.success', buildLocalTrackDebugSnapshot())
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          logCallDebug('local-media.reconcile.error', {
            message,
            ...buildLocalTrackDebugSnapshot()
          })
        }
      } finally {
        reconcileLocalTracksInFlightRef.current = false
      }
    }

    void reconcileLocalTracks()

    return () => {
      cancelled = true
    }
  }, [activeCall, localAudioSource, localVideoSource, membraneClientConnected, sessionToken, syncLocalMediaState, view, createPlaceholderVideoTrack])

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active') {
      return
    }

    logCallDebug('local-media.snapshot', buildLocalTrackDebugSnapshot())
  }, [
    activeCall,
    buildLocalTrackDebugSnapshot,
    localAudioSource,
    localAudioTrackCount,
    localVideoSource,
    localVideoTrackCount,
    logCallDebug
  ])

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
  }, [
    activeCall,
    localAudioTrackCount,
    localVideoTrackCount,
    mediaEncryptionSupported,
    membraneClientConnected,
    membraneRemoteTracks.length,
    resolveCapabilityFailureMessage
  ])

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
    let cancelled = false

    async function syncGroupMediaEncryption() {
      // Get participant device IDs (excluding our own)
      const participantDeviceIds = callParticipants
        .filter((p) => p.device_id !== localDeviceId)
        .map((p) => p.device_id)

      const isInitiator = currentCall.started_by_device_id === localDeviceId

      const result = await syncCallGroupMediaEncryption({
        activeCall: currentCall,
        participantDeviceIds,
        isInitiator,
        callSignals: callSignalsRef.current,
        localDeviceId,
        serverId: activeChatSummary?.serverId ?? null,
        membraneClient: membraneClientRef.current,
        getPeerConnection: (client) => getMembranePeerConnection(client as MembraneClient | null),
        ensureController: ensureMediaE2eeController,
        updateControllerKey: (controller, keyMaterialBase64) => controller.updateKey(keyMaterialBase64),
        attachController: (controller, connection) => controller.attach(connection),
        sendCallSignal,
        ensureRemoteSessions: ensureSignalSessionsForDevices,
        sessionToken: sessionToken ?? '',
        groupCallKeyMaterial: groupCallKeyMaterialRef.current,
        setGroupCallKeyMaterial: (key) => { groupCallKeyMaterialRef.current = key },
        groupCallKeyGeneratedForCallId: groupCallKeyGeneratedForCallIdRef.current,
        setGroupCallKeyGeneratedForCallId: (callId) => { groupCallKeyGeneratedForCallIdRef.current = callId },
        distributedParticipantDeviceIds: groupCallKeyDistributedDeviceIdsRef.current[currentCall.id] ?? [],
        setDistributedParticipantDeviceIds: (deviceIds) => {
          groupCallKeyDistributedDeviceIdsRef.current = {
            ...groupCallKeyDistributedDeviceIdsRef.current,
            [currentCall.id]: deviceIds
          }
        }
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
  }, [
    activeCall,
    callParticipants,
    localDeviceId,
    mediaEncryptionSupported,
    membraneClientConnected,
    ensureSignalSessionsForDevices,
    sessionToken,
    storedDevice
  ])

  useEffect(() => {
    const directMediaSyncState = shouldSyncDirectMediaEncryption(
      activeCall,
      mediaEncryptionSupported,
      sessionToken,
      membraneClientConnected
    )

    if (isEndingCall) {
      return
    }

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

      // Find the remote device ID from participants
      const remoteParticipant = callParticipants.find((p) => p.device_id !== localDeviceId)
      const remoteDeviceId = remoteParticipant?.device_id ?? null

      const result = await syncCallDirectMediaEncryption({
        activeCall: currentCall,
        remoteDeviceId,
        callSignals: callSignalsRef.current,
        localDeviceId,
        serverId: activeChatSummary?.serverId ?? null,
        isInitiator: currentCall.started_by_device_id === localDeviceId,
        membraneClient: membraneClientRef.current,
        getPeerConnection: (client) => getMembranePeerConnection(client as MembraneClient | null),
        ensureController: ensureMediaE2eeController,
        updateControllerKey: (controller, keyMaterialBase64) => controller.updateKey(keyMaterialBase64),
        attachController: (controller, connection) => controller.attach(connection),
        sendCallSignal,
        sessionToken: currentSessionToken,
        directCallKeyMaterial: directCallKeyMaterialRef.current,
        setDirectCallKeyMaterial: (key) => { directCallKeyMaterialRef.current = key },
        directCallKeyGeneratedForCallId: directCallKeyGeneratedForCallIdRef.current,
        setDirectCallKeyGeneratedForCallId: (callId) => { directCallKeyGeneratedForCallIdRef.current = callId },
        ensureRemoteSession: ensureSignalSessionForDevice
      })

      if (cancelled) {
        return
      }

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
  }, [
    activeCall,
    callParticipants,
    callSignals,
    isEndingCall,
    localDeviceId,
    mediaEncryptionSupported,
    membraneClientConnected,
    ensureSignalSessionForDevice,
    sessionToken
  ])

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
      onMediaEvent(payload) {
        handleRealtimeCallMediaEvent(payload)
      },
      onError: handleRealtimeCallSubscriptionError
    })
  }, [activeCallScope, deferredActiveChatId, handleRealtimeCallMediaEvent, sessionToken, view])

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
    if (attachLocalMediaInFlightRef.current) {
      await attachLocalMediaInFlightRef.current
    }

    if (!activeCall) {
      return
    }

    if (!ensureCallCapability('Local media attachment')) {
      return
    }

    const membraneTracksMutable =
      Boolean(membraneClientRef.current) &&
      membraneClientConnected &&
      membraneOfferInitializedRef.current &&
      canMutateMembraneTracks(membraneClientRef.current)

    logCallDebug('local-media.attach.request', {
      mode,
      membraneTracksMutable,
      hasClient: !!membraneClientRef.current,
      ...buildLocalTrackDebugSnapshot()
    })

    const run = async () => {
      setLoading(true)

      const currentStream = normalizeLocalStreamBindings(localMediaStreamRef.current)
      const alreadyHasAudio = (currentStream?.getAudioTracks().length ?? 0) > 0
      const alreadyHasVideo = (currentStream?.getVideoTracks().length ?? 0) > 0
      const audioBinding = membraneLocalTrackBindingsRef.current.find((binding) => binding.kind === 'audio') ?? null
      const videoBinding = membraneLocalTrackBindingsRef.current.find((binding) => binding.kind === 'video') ?? null
      const hasPlaceholderAudio = audioBinding?.source === 'placeholder'
      const hasPlaceholderVideo = videoBinding?.source === 'placeholder'

      if (currentStream && alreadyHasAudio && hasPlaceholderAudio) {
        const microphoneStream = await window.navigator.mediaDevices.getUserMedia({
          audio: buildCallAudioTrackConstraints(),
          video: false
        })
        const replacementTrack = microphoneStream.getAudioTracks()[0] ?? null

        if (!replacementTrack) {
          throw new Error('Failed to access microphone.')
        }

        const currentAudioTrack = currentStream.getAudioTracks()[0] ?? null

        if (membraneClientRef.current && membraneTracksMutable && audioBinding) {
          await replaceLocalTrackInMembrane(
            membraneClientRef.current,
            audioBinding.trackId,
            replacementTrack,
            { kind: 'audio', source: 'browser' }
          )
          audioBinding.mediaTrackId = replacementTrack.id
          audioBinding.source = 'browser'
          membraneLocalTrackIdsRef.current = membraneLocalTrackBindingsRef.current.map((binding) => binding.trackId)
        }

        if (currentAudioTrack) {
          currentStream.removeTrack(currentAudioTrack)
          currentAudioTrack.stop()
        }

        placeholderAudioCleanupRef.current?.()
        placeholderAudioCleanupRef.current = null

        currentStream.addTrack(replacementTrack)
        localMediaStreamRef.current = currentStream
        applyLocalAudioMutePreference(currentStream)

        if (mode === 'audio' && !alreadyHasVideo) {
          syncLocalMediaState(currentStream)
          await ensureLocalSenderIntegrity('attach-local-media:upgrade-audio')
          return
        }
      }

      if (currentStream && mode === 'audio' && alreadyHasAudio && (!alreadyHasVideo || hasPlaceholderVideo)) {
        applyLocalAudioMutePreference(currentStream)
        syncLocalMediaState(currentStream)
        await ensureLocalSenderIntegrity('attach-local-media:audio-existing-stream')
        return
      }

      if (currentStream && mode === 'audio_video' && alreadyHasAudio && alreadyHasVideo && !hasPlaceholderVideo) {
        applyLocalAudioMutePreference(currentStream)
        syncLocalMediaState(currentStream)
        await ensureLocalSenderIntegrity('attach-local-media:audio-video-existing-stream')
        return
      }

      if (currentStream && mode === 'audio' && alreadyHasVideo) {
        if (!hasPlaceholderVideo) {
          const placeholderTrack = createPlaceholderVideoTrack()
          const currentVideoTrack = currentStream.getVideoTracks()[0] ?? null

          if (membraneClientRef.current && membraneTracksMutable && videoBinding) {
            await replaceLocalTrackInMembrane(
              membraneClientRef.current,
              videoBinding.trackId,
              placeholderTrack,
              { kind: 'video', source: 'placeholder' }
            )
            videoBinding.mediaTrackId = placeholderTrack.id
            videoBinding.source = 'placeholder'
            membraneLocalTrackIdsRef.current = membraneLocalTrackBindingsRef.current.map((binding) => binding.trackId)
          }

          if (currentVideoTrack) {
            hiddenVideoTrackStateRef.current.delete(currentVideoTrack)
            currentStream.removeTrack(currentVideoTrack)
            currentVideoTrack.stop()
          }

          currentStream.addTrack(placeholderTrack)
        }

        localMediaStreamRef.current = currentStream
        applyLocalAudioMutePreference(currentStream)
        syncLocalMediaState(currentStream)
        await ensureLocalSenderIntegrity('attach-local-media:audio-with-video-placeholder')
        return
      }

      if (currentStream && mode === 'audio_video' && alreadyHasVideo && hasPlaceholderVideo) {
        const videoStream = await window.navigator.mediaDevices.getUserMedia({
          audio: false,
          video: buildCallVideoTrackConstraints('high')
        })

        const replacementTrack = videoStream.getVideoTracks()[0] ?? null

        if (!replacementTrack) {
          throw new Error('Failed to access camera.')
        }

        const currentVideoTrack = currentStream.getVideoTracks()[0] ?? null

        if (membraneClientRef.current && membraneTracksMutable && videoBinding) {
          await replaceLocalTrackInMembrane(
            membraneClientRef.current,
            videoBinding.trackId,
            replacementTrack,
            { kind: 'video', source: 'browser' }
          )
          videoBinding.mediaTrackId = replacementTrack.id
          videoBinding.source = 'browser'
          membraneLocalTrackIdsRef.current = membraneLocalTrackBindingsRef.current.map((binding) => binding.trackId)
        }

        if (currentVideoTrack) {
          hiddenVideoTrackStateRef.current.delete(currentVideoTrack)
          currentStream.removeTrack(currentVideoTrack)
          currentVideoTrack.stop()
        }

        placeholderVideoCleanupRef.current?.()
        placeholderVideoCleanupRef.current = null

        currentStream.addTrack(replacementTrack)
        localMediaStreamRef.current = currentStream
        applyLocalAudioMutePreference(currentStream)
        syncLocalMediaState(currentStream)
        await ensureLocalSenderIntegrity('attach-local-media:replace-placeholder-video')
        return
      }

      if (currentStream && mode === 'audio_video' && !alreadyHasVideo) {
        const videoStream = await window.navigator.mediaDevices.getUserMedia({
          audio: false,
          video: buildCallVideoTrackConstraints('high')
        })

        const videoTracks = videoStream.getVideoTracks()
        for (const track of videoTracks) {
          currentStream.addTrack(track)
        }

        if (membraneClientRef.current && membraneTracksMutable) {
          const bindings = await attachTracksWithBindings(
            membraneClientRef.current,
            currentStream,
            videoTracks
          )
          membraneLocalTrackBindingsRef.current = [
            ...membraneLocalTrackBindingsRef.current,
            ...bindings
          ]
          membraneLocalTrackIdsRef.current = membraneLocalTrackBindingsRef.current.map((binding) => binding.trackId)
        }

        localMediaStreamRef.current = currentStream
        applyLocalAudioMutePreference(currentStream)
        syncLocalMediaState(currentStream)
        await ensureLocalSenderIntegrity('attach-local-media:add-video-track')
        return
      }

      const membraneTrackIdsForReplacement = Array.from(new Set(
        membraneLocalTrackIdsRef.current.length > 0
          ? membraneLocalTrackIdsRef.current
          : getMembraneLocalTrackSnapshots(membraneClientRef.current).map((track) => track.trackId)
      ))

      const result = await replaceLocalMediaStream({
        mode,
        currentStream: localMediaStreamRef.current,
        membraneClient: membraneClientRef.current,
        membraneClientConnected: membraneTracksMutable,
        membraneLocalTrackIds: membraneTrackIdsForReplacement,
        removeLocalTracksFromMembrane,
        getUserMedia: (constraints) => window.navigator.mediaDevices.getUserMedia(constraints),
        attachLocalTracks: (client, stream) =>
          attachCallLocalTracks(client, stream, attachLocalTracksToMembrane)
      })

      localMediaStreamRef.current = result.stream
      applyLocalAudioMutePreference(result.stream)
      membraneLocalTrackIdsRef.current = result.trackIds
      membraneLocalTrackBindingsRef.current = result.stream.getTracks().map((track, index) => ({
        trackId: result.trackIds[index] ?? '',
        kind: track.kind as 'audio' | 'video',
        mediaTrackId: track.id,
        source: 'browser' as const
      })).filter((binding) => binding.trackId)

      syncLocalMediaState(result.stream)
      await ensureLocalSenderIntegrity('attach-local-media:replace-stream')
      logCallDebug('local-media.attach.success', {
        mode,
        membraneTracksMutable,
        ...buildLocalTrackDebugSnapshot()
      })
    }

    const promise = run()
      .catch((error) => {
        const message = describeMediaDeviceError(error)
        logCallDebug('local-media.attach.error', {
          mode,
          message,
          rawError: error instanceof Error ? error.message : String(error),
          ...buildLocalTrackDebugSnapshot()
        })
        logCallFailure('local-media-attach-failed', {
          mode,
          message
        })
        setBanner({ tone: 'error', message })
      })
      .finally(() => {
        setLoading(false)
        if (attachLocalMediaInFlightRef.current === promise) {
          attachLocalMediaInFlightRef.current = null
        }
      })

    attachLocalMediaInFlightRef.current = promise
    await promise
  }

  async function _handleReleaseLocalMedia() {
    placeholderAudioCleanupRef.current?.()
    placeholderAudioCleanupRef.current = null
    placeholderVideoCleanupRef.current?.()
    placeholderVideoCleanupRef.current = null
    await releaseLocalMediaResources(
      membraneClientRef.current,
      membraneLocalTrackIdsRef.current,
      localMediaStreamRef.current,
      removeLocalTracksFromMembrane
    )
    membraneLocalTrackIdsRef.current = []
    membraneLocalTrackBindingsRef.current = []

    localMediaStreamRef.current = null
    syncLocalMediaState(null)
    setBanner({
      tone: 'success',
      message: 'Local microphone/camera tracks were removed from the native Membrane pipeline.'
    })
  }

  async function _handleAttachScreenShare(stream: MediaStream): Promise<string[]> {
    const client = membraneClientRef.current
    if (!client || !membraneClientConnected || !membraneOfferInitializedRef.current) return []

    if (!canMutateMembraneTracks(client)) {
      return []
    }

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

    const currentMode = localVideoSource === 'browser' ? 'audio_video' : 'audio'
    const currentStream = normalizeLocalStreamBindings(localMediaStreamRef.current)

    if (currentStream) {
      const currentTrack =
        kind === 'audio'
          ? currentStream.getAudioTracks()[0] ?? null
          : currentStream.getVideoTracks()[0] ?? null

      if (currentTrack) {
        try {
          const replacementStream = await window.navigator.mediaDevices.getUserMedia({
            audio: kind === 'audio' ? buildCallAudioTrackConstraints(deviceId) : false,
            video:
              kind === 'video'
                ? buildCallVideoTrackConstraints('high', deviceId)
                : false
          })

          const replacementTrack =
            kind === 'audio'
              ? replacementStream.getAudioTracks()[0] ?? null
              : replacementStream.getVideoTracks()[0] ?? null

          if (!replacementTrack) {
            throw new Error(`Failed to open the selected ${kind} device.`)
          }

          const binding =
            membraneLocalTrackBindingsRef.current.find(
              (item) => item.kind === kind && item.mediaTrackId === currentTrack.id
            ) ??
            membraneLocalTrackBindingsRef.current.find((item) => item.kind === kind) ??
            null

          if (
            membraneClientRef.current &&
            membraneClientConnected &&
            membraneOfferInitializedRef.current &&
            canMutateMembraneTracks(membraneClientRef.current) &&
            binding
          ) {
            await replaceLocalTrackInMembrane(
              membraneClientRef.current,
              binding.trackId,
              replacementTrack,
              { kind, source: 'browser' }
            )
            binding.mediaTrackId = replacementTrack.id
            binding.source = 'browser'
            membraneLocalTrackIdsRef.current = membraneLocalTrackBindingsRef.current.map((item) => item.trackId)
          }

          if (kind === 'video') {
            hiddenVideoTrackStateRef.current.delete(currentTrack)
          }

          currentStream.removeTrack(currentTrack)
          currentTrack.stop()
          currentStream.addTrack(replacementTrack)
          localMediaStreamRef.current = currentStream
          applyLocalAudioMutePreference(currentStream)
          syncLocalMediaState(currentStream)
          await ensureLocalSenderIntegrity(`switch-device:${kind}:replace-track`)
          return
        } catch (error) {
          const message = describeMediaDeviceError(error)
          setBanner({ tone: 'error', message })
          return
        }
      }
    }

    try {
      const membraneTrackIdsForReplacement = Array.from(new Set(
        membraneLocalTrackIdsRef.current.length > 0
          ? membraneLocalTrackIdsRef.current
          : getMembraneLocalTrackSnapshots(membraneClientRef.current).map((track) => track.trackId)
      ))

      const audioConstraint = kind === 'audio'
        ? buildCallAudioTrackConstraints(deviceId)
        : buildCallAudioTrackConstraints()
      const videoConstraint = kind === 'video'
        ? buildCallVideoTrackConstraints('high', deviceId)
        : currentMode === 'audio_video'
          ? buildCallVideoTrackConstraints('high')
          : false

      const result = await replaceLocalMediaStream({
        mode: videoConstraint ? 'audio_video' : 'audio',
        currentStream: localMediaStreamRef.current,
        membraneClient: membraneClientRef.current,
        membraneClientConnected:
          membraneClientConnected &&
          membraneOfferInitializedRef.current &&
          canMutateMembraneTracks(membraneClientRef.current),
        membraneLocalTrackIds: membraneTrackIdsForReplacement,
        removeLocalTracksFromMembrane,
        getUserMedia: () =>
          window.navigator.mediaDevices.getUserMedia({
            audio: audioConstraint,
            video: videoConstraint
          }),
        attachLocalTracks: (client, stream) =>
          attachCallLocalTracks(client, stream, attachLocalTracksToMembrane)
      })

      localMediaStreamRef.current = result.stream
      applyLocalAudioMutePreference(result.stream)
      membraneLocalTrackIdsRef.current = result.trackIds
      membraneLocalTrackBindingsRef.current = result.stream.getTracks().map((track, index) => ({
        trackId: result.trackIds[index] ?? '',
        kind: track.kind as 'audio' | 'video',
        mediaTrackId: track.id,
        source: 'browser' as const
      })).filter((binding) => binding.trackId)
      syncLocalMediaState(result.stream)
      await ensureLocalSenderIntegrity(`switch-device:${kind}:replace-stream`)
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
    reconnectState,
    callTransportStatus,
    transportReadiness,
    turnCredentials,
    callQualityIndicator,
    callQualityProfile,
    localAudioTrackCount,
    localVideoTrackCount,
    localAudioSource,
    localVideoSource,
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
    setLocalAudioMuted,
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

function toSignalPrekeyBundle(bundle: PrekeyDeviceBundle | undefined): VostokPrekeyBundle | null {
  if (
    !bundle ||
    !bundle.signed_prekey ||
    !bundle.signed_prekey_signature ||
    bundle.registration_id == null ||
    bundle.signed_prekey_id == null ||
    bundle.kyber_prekey_id == null ||
    !bundle.kyber_prekey ||
    !bundle.kyber_prekey_signature
  ) {
    return null
  }

  return {
    device_id: bundle.device_id,
    identity_public_key: bundle.identity_public_key,
    registration_id: bundle.registration_id,
    signed_prekey_id: bundle.signed_prekey_id,
    signed_prekey_public: bundle.signed_prekey,
    signed_prekey_signature: bundle.signed_prekey_signature,
    one_time_prekey_id: bundle.one_time_prekey_id ?? undefined,
    one_time_prekey_public: bundle.one_time_prekey ?? undefined,
    kyber_prekey_id: bundle.kyber_prekey_id,
    kyber_prekey_public: bundle.kyber_prekey,
    kyber_prekey_signature: bundle.kyber_prekey_signature
  }
}
