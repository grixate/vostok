import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent
} from 'react'
import { GlassSurface } from '@vostok/ui-primitives'
import {
  CallSurface,
  ChatInfoPanel,
  ChatListItem,
  ContextMenu,
  ConversationHeader,
  MessageBubble,
  ReactionBar
} from '@vostok/ui-chat'
import {
  appendMediaUploadPart,
  createCallSession,
  createFederationPeer,
  recordFederationPeerHeartbeat,
  bootstrapChatSessions,
  completeMediaUpload,
  createDirectChat,
  createGroupChat,
  createMediaUpload,
  createMessage,
  endCallSession,
  fetchCallWebRtcEndpointState,
  fetchCallState,
  toggleMessageReaction,
  fetchAdminOverview,
  fetchActiveCall,
  fetchMediaUpload,
  fetchTurnCredentials,
  fetchUserPrekeys,
  fetchMe,
  issueChallenge,
  joinCallSession,
  listRecipientDevices,
  listChats,
  listFederationPeers,
  listMessages,
  leaveCallSession,
  pollCallWebRtcMediaEvents,
  publishDevicePrekeys,
  provisionCallWebRtcEndpoint,
  pushCallWebRtcMediaEvent,
  registerDevice,
  sendCallSignal,
  updateFederationPeerStatus,
  verifyChallenge,
  type AdminOverview,
  type CallParticipant,
  type CallRoomState,
  type CallSignal,
  type CallSession,
  type CallWebRtcEndpointState,
  type ChatDeviceSession,
  type ChatMessage,
  type ChatSummary,
  type FederationPeer,
  type RecipientDevice,
  type PrekeyDeviceBundle,
  type TurnCredentials
} from './lib/api'
import {
  generateDeviceIdentity,
  generateDevicePrekeys,
  signChallenge,
  type PrekeyPair,
  type SignedPrekeyPair
} from './lib/device-auth'
import {
  encryptMessageWithSessions,
  prepareSessionBootstrap,
  synchronizeChatSessions,
  type LocalSessionDeviceMaterial
} from './lib/chat-session-vault'
import { readCachedMessages, writeCachedMessages, type CachedMessage } from './lib/message-cache'
import {
  decryptMessageText,
  encryptLegacyMessageText,
  encryptMessageEnvelope
} from './lib/message-vault'
import { subscribeToCallStream, subscribeToChatStream } from './lib/realtime'
import {
  decryptAttachmentFile,
  encryptAttachmentFile,
  generateAttachmentThumbnailDataUrl
} from './lib/attachment-vault'
import {
  attachLocalMediaTracks,
  applyRemoteAnswer,
  applyRemoteIceCandidate,
  applyRemoteOfferAndCreateAnswer,
  closeWebRtcLab,
  createOfferPayload,
  createWebRtcLab,
  detachLocalMediaTracks,
  readDescriptionPayload,
  readRemoteDescriptionPayload
} from './lib/webrtc-lab'
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
} from './lib/membrane-native'
import {
  applyDesktopWindowGeometry,
  closeDesktopWindow,
  fetchDesktopWindowGeometry,
  fetchDesktopRuntimeInfo,
  fetchDesktopWindowState,
  type DesktopWindowGeometry,
  isDesktopShell,
  minimizeDesktopWindow,
  resetDesktopWindowGeometry,
  setDesktopWindowAlwaysOnTop as applyDesktopWindowAlwaysOnTop,
  subscribeDesktopWindowGeometry,
  setDesktopWindowTitle,
  subscribeDesktopWindowState,
  toggleDesktopWindowAlwaysOnTop,
  toggleDesktopWindowFullscreen,
  toggleDesktopWindowMaximize,
  type DesktopRuntimeInfo
} from './lib/desktop-shell'
import { base64ToBytes } from './lib/base64'

type AuthView = 'welcome' | 'register' | 'login' | 'link' | 'chat'

type StoredDevice = {
  deviceId: string
  deviceName: string
  privateKeyPkcs8Base64: string
  publicKeyBase64: string
  encryptionPrivateKeyPkcs8Base64?: string
  encryptionPublicKeyBase64?: string
  signedPrekeyPublicKeyBase64?: string
  signedPrekeyPrivateKeyPkcs8Base64?: string
  signedPrekeys?: SignedPrekeyPair[]
  oneTimePrekeys?: PrekeyPair[]
  sessionExpiresAt: string
  sessionToken: string
  username: string
}

type Banner = {
  tone: 'error' | 'info' | 'success'
  message: string
}

type AttachmentDescriptor = {
  kind: 'attachment'
  uploadId: string
  fileName: string
  contentType: string
  size: number
  thumbnailDataUrl?: string
  contentKeyBase64: string
  ivBase64: string
}

const STORAGE_KEY = 'vostok.device'
const DETAIL_RAIL_STORAGE_KEY = 'vostok.layout.detail_rail_visible'
const DESKTOP_ALWAYS_ON_TOP_STORAGE_KEY = 'vostok.desktop.always_on_top'
const DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY = 'vostok.desktop.window_geometry'
const DESKTOP_DETAIL_RAIL_BREAKPOINT = 1200
const CALL_SIGNAL_BROADCAST = '__broadcast__'

function readStoredDevice(): StoredDevice | null {
  const raw = window.localStorage.getItem(STORAGE_KEY)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as StoredDevice
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

function persistStoredDevice(device: StoredDevice | null) {
  if (device) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(device))
    return
  }

  window.localStorage.removeItem(STORAGE_KEY)
}

function readDetailRailPreference(): boolean {
  if (typeof window === 'undefined') {
    return true
  }

  const raw = window.localStorage.getItem(DETAIL_RAIL_STORAGE_KEY)

  if (raw === 'true') {
    return true
  }

  if (raw === 'false') {
    return false
  }

  return window.innerWidth >= DESKTOP_DETAIL_RAIL_BREAKPOINT
}

function readDesktopWindowGeometry(): DesktopWindowGeometry | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY)

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DesktopWindowGeometry>

    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return {
        x: parsed.x,
        y: parsed.y,
        width: parsed.width,
        height: parsed.height
      }
    }
  } catch {
    // Fall through to remove invalid desktop geometry state.
  }

  window.localStorage.removeItem(DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY)
  return null
}

function App() {
  const [storedDevice, setStoredDevice] = useState<StoredDevice | null>(() => readStoredDevice())
  const [view, setView] = useState<AuthView>(() => (readStoredDevice() ? 'chat' : 'welcome'))
  const [username, setUsername] = useState('')
  const [deviceName, setDeviceName] = useState('This browser')
  const [profileUsername, setProfileUsername] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [chatItems, setChatItems] = useState<ChatSummary[]>([])
  const [chatFilter, setChatFilter] = useState('')
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [detailRailPreferred, setDetailRailPreferred] = useState(() => readDetailRailPreference())
  const [isDesktopWide, setIsDesktopWide] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= DESKTOP_DETAIL_RAIL_BREAKPOINT
  )
  const [desktopRuntime, setDesktopRuntime] = useState<DesktopRuntimeInfo | null>(null)
  const [desktopWindowMaximized, setDesktopWindowMaximized] = useState<boolean | null>(null)
  const [desktopWindowFocused, setDesktopWindowFocused] = useState<boolean | null>(null)
  const [desktopWindowAlwaysOnTop, setDesktopWindowAlwaysOnTop] = useState<boolean | null>(null)
  const [desktopWindowFullscreen, setDesktopWindowFullscreen] = useState<boolean | null>(null)
  const [desktopWindowGeometry, setDesktopWindowGeometry] = useState<DesktopWindowGeometry | null>(null)
  const [messageItems, setMessageItems] = useState<CachedMessage[]>([])
  const [draft, setDraft] = useState('')
  const [replyTargetMessageId, setReplyTargetMessageId] = useState<string | null>(null)
  const [newChatUsername, setNewChatUsername] = useState('')
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [newGroupMembers, setNewGroupMembers] = useState('')
  const [remotePrekeyBundles, setRemotePrekeyBundles] = useState<PrekeyDeviceBundle[]>([])
  const [chatSessions, setChatSessions] = useState<ChatDeviceSession[]>([])
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null)
  const [federationPeers, setFederationPeers] = useState<FederationPeer[]>([])
  const [federationDomain, setFederationDomain] = useState('')
  const [federationDisplayName, setFederationDisplayName] = useState('')
  const [turnCredentials, setTurnCredentials] = useState<TurnCredentials | null>(null)
  const [activeCall, setActiveCall] = useState<CallSession | null>(null)
  const [callParticipants, setCallParticipants] = useState<CallParticipant[]>([])
  const [callRoom, setCallRoom] = useState<CallRoomState | null>(null)
  const [callWebRtcEndpoint, setCallWebRtcEndpoint] = useState<CallWebRtcEndpointState | null>(null)
  const [callWebRtcMediaEvents, setCallWebRtcMediaEvents] = useState<string[]>([])
  const [callSignals, setCallSignals] = useState<CallSignal[]>([])
  const [callSignalType, setCallSignalType] = useState<CallSignal['signal_type']>('offer')
  const [callSignalTargetDeviceId, setCallSignalTargetDeviceId] = useState<string>(CALL_SIGNAL_BROADCAST)
  const [callSignalPayload, setCallSignalPayload] = useState('{"type":"offer","sdp":"stub-offer"}')
  const [webRtcReady, setWebRtcReady] = useState(false)
  const [webRtcConnectionState, setWebRtcConnectionState] =
    useState<RTCPeerConnectionState>('new')
  const [webRtcSignalingState, setWebRtcSignalingState] =
    useState<RTCSignalingState>('stable')
  const [webRtcLocalDescription, setWebRtcLocalDescription] = useState<string | null>(null)
  const [webRtcRemoteDescription, setWebRtcRemoteDescription] = useState<string | null>(null)
  const [webRtcIceOutboundCount, setWebRtcIceOutboundCount] = useState(0)
  const [webRtcIceInboundCount, setWebRtcIceInboundCount] = useState(0)
  const [localMediaMode, setLocalMediaMode] = useState<'none' | 'audio' | 'audio_video'>('none')
  const [localAudioTrackCount, setLocalAudioTrackCount] = useState(0)
  const [localVideoTrackCount, setLocalVideoTrackCount] = useState(0)
  const [remoteAudioTrackCount, setRemoteAudioTrackCount] = useState(0)
  const [remoteVideoTrackCount, setRemoteVideoTrackCount] = useState(0)
  const [localMediaRevision, setLocalMediaRevision] = useState(0)
  const [membraneClientReady, setMembraneClientReady] = useState(false)
  const [membraneClientConnected, setMembraneClientConnected] = useState(false)
  const [membraneRemoteEndpointCount, setMembraneRemoteEndpointCount] = useState(0)
  const [membraneRemoteTrackCount, setMembraneRemoteTrackCount] = useState(0)
  const [membraneReadyTrackCount, setMembraneReadyTrackCount] = useState(0)
  const [membraneReadyAudioTrackCount, setMembraneReadyAudioTrackCount] = useState(0)
  const [membraneReadyVideoTrackCount, setMembraneReadyVideoTrackCount] = useState(0)
  const [membraneRemoteEndpointIds, setMembraneRemoteEndpointIds] = useState<string[]>([])
  const [membraneRemoteTrackIds, setMembraneRemoteTrackIds] = useState<string[]>([])
  const [membraneRemoteEndpoints, setMembraneRemoteEndpoints] = useState<
    MembraneRemoteEndpointSnapshot[]
  >([])
  const [membraneRemoteTracks, setMembraneRemoteTracks] = useState<MembraneRemoteTrackSnapshot[]>(
    []
  )
  const [membraneClientEndpointId, setMembraneClientEndpointId] = useState<string | null>(null)

  const deferredActiveChatId = useDeferredValue(activeChatId)
  const activeChatIdRef = useRef<string | null>(deferredActiveChatId)
  const messageItemsRef = useRef<CachedMessage[]>([])
  const callSignalsRef = useRef<CallSignal[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const chatButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const chatFilterInputRef = useRef<HTMLInputElement | null>(null)
  const directChatInputRef = useRef<HTMLInputElement | null>(null)
  const groupTitleInputRef = useRef<HTMLInputElement | null>(null)
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const membraneClientRef = useRef<MembraneClient | null>(null)
  const membraneClientCallIdRef = useRef<string | null>(null)
  const membraneLocalTrackIdsRef = useRef<string[]>([])
  const webRtcCallIdRef = useRef<string | null>(null)
  const localMediaStreamRef = useRef<MediaStream | null>(null)

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
    detachLocalMediaTracks(peerConnectionRef.current, localMediaStreamRef.current)
    closeWebRtcLab(peerConnectionRef.current)
    resetMembraneClient()
    localMediaStreamRef.current = null
    peerConnectionRef.current = null
    webRtcCallIdRef.current = null
    setWebRtcReady(false)
    setWebRtcConnectionState('new')
    setWebRtcSignalingState('stable')
    setWebRtcLocalDescription(null)
    setWebRtcRemoteDescription(null)
    setWebRtcIceOutboundCount(0)
    setWebRtcIceInboundCount(0)
    setLocalMediaMode('none')
    setLocalAudioTrackCount(0)
    setLocalVideoTrackCount(0)
    setRemoteAudioTrackCount(0)
    setRemoteVideoTrackCount(0)
  }

  function ensureWebRtcLab(): RTCPeerConnection {
    const activeCallId = activeCall?.id ?? null

    if (!activeCallId) {
      throw new Error('No active call is available for browser WebRTC bootstrap.')
    }

    if (peerConnectionRef.current && webRtcCallIdRef.current === activeCallId) {
      return peerConnectionRef.current
    }

    if (peerConnectionRef.current) {
      resetWebRtcLab()
    }

    const peer = createWebRtcLab(turnCredentials, {
      onIceCandidate(payload) {
        setWebRtcIceOutboundCount((current) => current + 1)
        void emitCallSignalPayload('ice', payload)
      },
      onConnectionStateChange(connectionState) {
        setWebRtcConnectionState(connectionState)
      },
      onSignalingStateChange(signalingState) {
        setWebRtcSignalingState(signalingState)
      },
      onRemoteTrackCountsChange(payload) {
        setRemoteAudioTrackCount(payload.audio)
        setRemoteVideoTrackCount(payload.video)
      }
    })

    peerConnectionRef.current = peer
    webRtcCallIdRef.current = activeCallId
    setWebRtcReady(true)
    setWebRtcConnectionState(peer.connectionState)
    setWebRtcSignalingState(peer.signalingState)

    return peer
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
          .catch(() => {
            // The Phoenix call-signal channel remains the explicit fallback path.
          })
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
  async function syncChatSessionsFromServer(
    chatId: string,
    knownRecipientDevices?: RecipientDevice[]
  ): Promise<ChatDeviceSession[]> {
    if (!storedDevice || activeChatIdRef.current !== chatId) {
      return []
    }

    const recipientDevices =
      knownRecipientDevices ??
      (await listRecipientDevices(storedDevice.sessionToken, chatId)).recipient_devices
    const initiatorEphemeralKeys = await prepareSessionBootstrap(
      recipientDevices.map((device) => device.device_id)
    )
    const response = await bootstrapChatSessions(storedDevice.sessionToken, chatId, {
      initiator_ephemeral_keys: initiatorEphemeralKeys
    })
    const synchronizedIds = await synchronizeChatSessions(
      toLocalSessionDeviceMaterial(storedDevice),
      response.sessions
    )
    const activeSessions = response.sessions.filter((session) => synchronizedIds.includes(session.id))

    if (activeChatIdRef.current === chatId) {
      setChatSessions(activeSessions)
    }

    return activeSessions
  }
  const syncMessagesFromServer = useEffectEvent(async (chatId: string) => {
    if (!storedDevice || activeChatIdRef.current !== chatId) {
      return
    }

    await syncChatSessionsFromServer(chatId)

    const response = await listMessages(storedDevice.sessionToken, chatId)
    const projected = await Promise.all(
      response.messages.map((message) =>
        projectMessage(
          message,
          storedDevice.deviceId,
          storedDevice.encryptionPrivateKeyPkcs8Base64
        )
      )
    )

    if (activeChatIdRef.current !== chatId) {
      return
    }

    replaceActiveMessages(chatId, projected, true)
  })
  const handleRealtimeMessage = useEffectEvent((messageId: string, chatId: string) => {
    if (messageItemsRef.current.some((message) => message.id === messageId)) {
      return
    }

    void syncMessagesFromServer(chatId)
  })
  const handleRealtimeSubscriptionError = useEffectEvent(() => {
    setBanner({
      tone: 'error',
      message: 'Realtime chat subscription failed. HTTP sync is still available.'
    })
  })
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
      void processCallSignalForWebRtc(payload.signal)
    }
  )
  const handleRealtimeCallSubscriptionError = useEffectEvent(() => {
    setBanner({
      tone: 'error',
      message: 'Realtime call subscription failed. Manual call refresh is still available.'
    })
  })

  async function processCallSignalForWebRtc(signal: CallSignal) {
    if (!storedDevice || !activeCall || signal.call_id !== activeCall.id) {
      return
    }

    if (signal.from_device_id === storedDevice.deviceId) {
      return
    }

    if (membraneClientConnected) {
      return
    }

    try {
      const peer = ensureWebRtcLab()

      if (signal.signal_type === 'offer') {
        const answerPayload = await applyRemoteOfferAndCreateAnswer(peer, signal.payload)
        setWebRtcRemoteDescription(readRemoteDescriptionPayload(peer))
        setWebRtcLocalDescription(readDescriptionPayload(peer))
        await emitCallSignalPayload('answer', answerPayload)
        return
      }

      if (signal.signal_type === 'answer') {
        await applyRemoteAnswer(peer, signal.payload)
        setWebRtcRemoteDescription(readRemoteDescriptionPayload(peer))
        return
      }

      if (signal.signal_type === 'ice') {
        await applyRemoteIceCandidate(peer, signal.payload)
        setWebRtcIceInboundCount((current) => current + 1)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process inbound call signal.'
      setBanner({ tone: 'error', message })
    }
  }
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
          // The fallback bridge path stays available even if a native event is malformed.
        }
      }
    }

    const bridgeSignals = events
      .map((eventPayload) => parseMembraneBridgeSignal(eventPayload))
      .filter((signal): signal is CallSignal => signal !== null)

    if (bridgeSignals.length === 0) {
      return
    }

    let nextSignals = callSignalsRef.current

    for (const signal of bridgeSignals) {
      const seen = nextSignals.some((candidate) => candidate.id === signal.id)
      nextSignals = mergeCallSignals(nextSignals, signal)

      if (
        !seen &&
        storedDevice &&
        activeCall &&
        signal.call_id === activeCall.id &&
        signal.from_device_id !== storedDevice.deviceId
      ) {
        void processCallSignalForWebRtc(signal)
      }
    }

    callSignalsRef.current = nextSignals
    setCallSignals(nextSignals)
  })

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setBanner({ tone: 'info', message: 'Generating a local device identity…' })

    try {
      const identity = await generateDeviceIdentity()
      const devicePrekeys = await generateDevicePrekeys(identity.signingPrivateKeyPkcs8Base64)

      setBanner({ tone: 'info', message: 'Registering this device with the Vostok server…' })

      const response = await registerDevice({
        username,
        device_name: deviceName,
        device_identity_public_key: identity.signingPublicKeyBase64,
        device_encryption_public_key: identity.encryptionPublicKeyBase64,
        signed_prekey: devicePrekeys.signedPrekey.publicKeyBase64,
        signed_prekey_signature: devicePrekeys.signedPrekey.signatureBase64,
        one_time_prekeys: devicePrekeys.oneTimePrekeys.map((prekey) => prekey.publicKeyBase64)
      })

      const nextStoredDevice: StoredDevice = {
        deviceId: response.device.id,
        deviceName: response.device.device_name,
        privateKeyPkcs8Base64: identity.signingPrivateKeyPkcs8Base64,
        publicKeyBase64: identity.signingPublicKeyBase64,
        encryptionPrivateKeyPkcs8Base64: identity.encryptionPrivateKeyPkcs8Base64,
        encryptionPublicKeyBase64: identity.encryptionPublicKeyBase64,
        signedPrekeyPublicKeyBase64: devicePrekeys.signedPrekey.publicKeyBase64,
        signedPrekeyPrivateKeyPkcs8Base64: devicePrekeys.signedPrekey.privateKeyPkcs8Base64,
        signedPrekeys: [devicePrekeys.signedPrekey],
        oneTimePrekeys: devicePrekeys.oneTimePrekeys,
        sessionExpiresAt: response.session.expires_at,
        sessionToken: response.session.token,
        username: response.user.username
      }

      persistStoredDevice(nextStoredDevice)
      setStoredDevice(nextStoredDevice)
      setProfileUsername(response.user.username)
      setNewChatUsername(response.user.username)
      setBanner({
        tone: 'success',
        message: `Device registered. Session token issued with ${response.prekey_count} one-time prekeys.`
      })
      startTransition(() => setView('chat'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleReauthenticate() {
    if (!storedDevice) {
      setBanner({ tone: 'error', message: 'No local device identity is available.' })
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: 'Requesting a device challenge…' })

    try {
      const challenge = await issueChallenge(storedDevice.deviceId)
      const signature = await signChallenge(challenge.challenge, storedDevice.privateKeyPkcs8Base64)
      const response = await verifyChallenge(storedDevice.deviceId, challenge.challenge_id, signature)

      const nextStoredDevice = {
        ...storedDevice,
        sessionExpiresAt: response.session.expires_at,
        sessionToken: response.session.token
      }

      persistStoredDevice(nextStoredDevice)
      setStoredDevice(nextStoredDevice)
      setBanner({ tone: 'success', message: 'Challenge verified. Session refreshed.' })
      startTransition(() => setView('chat'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleRotatePrekeys() {
    if (!storedDevice) {
      setBanner({ tone: 'error', message: 'No local device identity is available.' })
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: 'Generating a fresh signed prekey and one-time prekeys…' })

    try {
      const devicePrekeys = await generateDevicePrekeys(storedDevice.privateKeyPkcs8Base64)
      const response = await publishDevicePrekeys(storedDevice.sessionToken, {
        signed_prekey: devicePrekeys.signedPrekey.publicKeyBase64,
        signed_prekey_signature: devicePrekeys.signedPrekey.signatureBase64,
        one_time_prekeys: devicePrekeys.oneTimePrekeys.map((prekey) => prekey.publicKeyBase64),
        replace_one_time_prekeys: true
      })

      const nextStoredDevice: StoredDevice = {
        ...storedDevice,
        signedPrekeyPublicKeyBase64: devicePrekeys.signedPrekey.publicKeyBase64,
        signedPrekeyPrivateKeyPkcs8Base64: devicePrekeys.signedPrekey.privateKeyPkcs8Base64,
        signedPrekeys: [...(storedDevice.signedPrekeys ?? []), devicePrekeys.signedPrekey],
        oneTimePrekeys: [...(storedDevice.oneTimePrekeys ?? []), ...devicePrekeys.oneTimePrekeys]
      }

      persistStoredDevice(nextStoredDevice)
      setStoredDevice(nextStoredDevice)
      setBanner({
        tone: 'success',
        message: `Prekeys rotated. ${response.one_time_prekey_count} one-time prekeys are active on the server.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rotate prekeys.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  function handleForgetDevice() {
    persistStoredDevice(null)
    setStoredDevice(null)
    setChatSessions([])
    setRemotePrekeyBundles([])
    setAdminOverview(null)
    setFederationPeers([])
    setTurnCredentials(null)
    setActiveCall(null)
    setCallParticipants([])
    setCallRoom(null)
    setCallWebRtcEndpoint(null)
    setCallWebRtcMediaEvents([])
    callSignalsRef.current = []
    setCallSignals([])
    resetWebRtcLab()
    setBanner({ tone: 'info', message: 'Local device identity cleared from this browser.' })
    startTransition(() => setView('welcome'))
  }

  useEffect(() => {
    const nextDefault = storedDevice?.username ?? ''
    setProfileUsername(storedDevice?.username ?? null)
    setNewChatUsername((current) => (current === '' ? nextDefault : current))
  }, [storedDevice])

  useEffect(() => {
    activeChatIdRef.current = deferredActiveChatId
  }, [deferredActiveChatId])

  useEffect(() => {
    messageItemsRef.current = messageItems
  }, [messageItems])

  useEffect(() => {
    callSignalsRef.current = callSignals
  }, [callSignals])

  useEffect(() => {
    if (!storedDevice) {
      setCallSignalTargetDeviceId(CALL_SIGNAL_BROADCAST)
      return
    }

    const selectedIsValid =
      callSignalTargetDeviceId === CALL_SIGNAL_BROADCAST ||
      callParticipants.some(
        (participant) =>
          participant.status === 'joined' &&
          participant.device_id !== storedDevice.deviceId &&
          participant.device_id === callSignalTargetDeviceId
      )

    if (!selectedIsValid) {
      setCallSignalTargetDeviceId(CALL_SIGNAL_BROADCAST)
    }
  }, [callParticipants, callSignalTargetDeviceId, storedDevice])

  useEffect(() => {
    if (view !== 'chat' || !storedDevice) {
      return
    }

    const { sessionToken } = storedDevice
    let cancelled = false

    async function bootstrapChatShell() {
      setLoading(true)

      try {
        const me = await fetchMe(sessionToken)
        const chatResponse = await listChats(sessionToken)
        let nextChats = chatResponse.chats

        if (nextChats.length === 0) {
          const created = await createDirectChat(sessionToken, me.user.username)
          nextChats = [created.chat]
        }

        if (cancelled) {
          return
        }

        setProfileUsername(me.user.username)
        setChatItems(nextChats)
        setActiveChatId((current) => current ?? nextChats[0]?.id ?? null)
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load chats.'
          setBanner({ tone: 'error', message })
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void bootstrapChatShell()

    return () => {
      cancelled = true
    }
  }, [storedDevice, view])

  useEffect(() => {
    if (!storedDevice || !deferredActiveChatId || view !== 'chat') {
      setChatSessions([])
      setReplyTargetMessageId(null)
      return
    }

    const chatId = deferredActiveChatId
    let cancelled = false
    setReplyTargetMessageId(null)

    async function loadMessages() {
      try {
        const cached = await readCachedMessages(chatId)

        if (cancelled) {
          return
        }

        if (cached.length > 0) {
          messageItemsRef.current = cached
          setMessageItems(cached)
        } else {
          messageItemsRef.current = []
          setMessageItems([])
        }

        await syncMessagesFromServer(chatId)
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load messages.'
          setBanner({ tone: 'error', message })
        }
      }
    }

    void loadMessages()

    return () => {
      cancelled = true
    }
  }, [deferredActiveChatId, storedDevice, view])

  useEffect(() => {
    if (!storedDevice || !deferredActiveChatId || view !== 'chat') {
      return
    }

    const chatId = deferredActiveChatId

    return subscribeToChatStream(storedDevice.sessionToken, chatId, {
      onMessage(messageId) {
        handleRealtimeMessage(messageId, chatId)
      },
      onError: handleRealtimeSubscriptionError
    })
  }, [deferredActiveChatId, storedDevice, view])

  useEffect(() => {
    if (!storedDevice || view !== 'chat') {
      setRemotePrekeyBundles([])
      return
    }

    const selectedChat = chatItems.find((chat) => chat.id === deferredActiveChatId) ?? chatItems[0] ?? null

    if (!selectedChat) {
      setRemotePrekeyBundles([])
      return
    }

    const targetUsername =
      selectedChat.participant_usernames.find((participant) => participant !== storedDevice.username) ??
      storedDevice.username
    const sessionToken = storedDevice.sessionToken

    let cancelled = false

    async function loadRemotePrekeys() {
      try {
        const response = await fetchUserPrekeys(sessionToken, targetUsername)

        if (!cancelled) {
          setRemotePrekeyBundles(response.devices)
        }
      } catch {
        if (!cancelled) {
          setRemotePrekeyBundles([])
        }
      }
    }

    void loadRemotePrekeys()

    return () => {
      cancelled = true
    }
  }, [chatItems, deferredActiveChatId, storedDevice, view])

  useEffect(() => {
    if (!storedDevice || view !== 'chat') {
      setAdminOverview(null)
      setFederationPeers([])
      setTurnCredentials(null)
      return
    }

    const sessionToken = storedDevice.sessionToken
    let cancelled = false

    async function loadOpsSurface() {
      try {
        const [overviewResponse, peersResponse, turnResponse] = await Promise.all([
          fetchAdminOverview(sessionToken),
          listFederationPeers(sessionToken),
          fetchTurnCredentials(sessionToken, { ttl_seconds: 600 })
        ])

        if (cancelled) {
          return
        }

        setAdminOverview(overviewResponse.overview)
        setFederationPeers(peersResponse.peers)
        setTurnCredentials(turnResponse.turn)
      } catch {
        if (!cancelled) {
          setAdminOverview(null)
          setFederationPeers([])
          setTurnCredentials(null)
        }
      }
    }

    void loadOpsSurface()

    return () => {
      cancelled = true
    }
  }, [storedDevice, view])

  useEffect(() => {
    if (!storedDevice || !deferredActiveChatId || view !== 'chat') {
      setActiveCall(null)
      setCallParticipants([])
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

  useEffect(() => {
    if (!storedDevice || !activeCall || view !== 'chat') {
      setCallParticipants([])
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
          const endpointResponse = await fetchCallWebRtcEndpointState(sessionToken, callId)

          if (!cancelled) {
            setCallWebRtcEndpoint(endpointResponse.endpoint)
            setCallRoom(endpointResponse.room ?? response.room)
          }
        }
      } catch {
        if (!cancelled) {
          setCallParticipants([])
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
        // The Phoenix call-signal channel remains the primary transport today.
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
  }, [activeCall, localMediaRevision, membraneClientConnected, storedDevice, view])

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncViewportMode = () => {
      setIsDesktopWide(window.innerWidth >= DESKTOP_DETAIL_RAIL_BREAKPOINT)
    }

    syncViewportMode()
    window.addEventListener('resize', syncViewportMode)

    return () => {
      window.removeEventListener('resize', syncViewportMode)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(DETAIL_RAIL_STORAGE_KEY, String(detailRailPreferred))
  }, [detailRailPreferred])

  useEffect(() => {
    if (typeof window === 'undefined' || desktopWindowAlwaysOnTop === null) {
      return
    }

    window.localStorage.setItem(
      DESKTOP_ALWAYS_ON_TOP_STORAGE_KEY,
      String(desktopWindowAlwaysOnTop)
    )
  }, [desktopWindowAlwaysOnTop])

  useEffect(() => {
    if (!isDesktopShell()) {
      setDesktopRuntime(null)
      setDesktopWindowMaximized(null)
      setDesktopWindowFocused(null)
      setDesktopWindowAlwaysOnTop(null)
      setDesktopWindowFullscreen(null)
      setDesktopWindowGeometry(null)
      return
    }

    let cancelled = false
    let stopStateSync: (() => void) | null = null
    let stopGeometrySync: (() => void) | null = null

    async function loadDesktopRuntime() {
      try {
        const savedGeometry = readDesktopWindowGeometry()
        const savedAlwaysOnTop = readDesktopAlwaysOnTopPreference()

        if (savedGeometry) {
          await applyDesktopWindowGeometry(savedGeometry)
        }

        const [runtime, initialWindowState, geometry, unlistenState, unlistenGeometry] = await Promise.all([
          fetchDesktopRuntimeInfo(),
          fetchDesktopWindowState(),
          fetchDesktopWindowGeometry(),
          subscribeDesktopWindowState((nextState) => {
            if (!cancelled) {
              setDesktopWindowMaximized(nextState.maximized)
              setDesktopWindowFocused(nextState.focused)
              setDesktopWindowAlwaysOnTop(nextState.alwaysOnTop)
              setDesktopWindowFullscreen(nextState.fullscreen)
            }
          }),
          subscribeDesktopWindowGeometry((nextGeometry) => {
            if (!cancelled) {
              setDesktopWindowGeometry(nextGeometry)
              window.localStorage.setItem(
                DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY,
                JSON.stringify(nextGeometry)
              )
            }
          })
        ])

        const windowState =
          savedAlwaysOnTop === null || savedAlwaysOnTop === initialWindowState.alwaysOnTop
            ? initialWindowState
            : {
                ...initialWindowState,
                alwaysOnTop: await applyDesktopWindowAlwaysOnTop(savedAlwaysOnTop)
              }

        if (!cancelled) {
          setDesktopRuntime(runtime)
          setDesktopWindowMaximized(windowState.maximized)
          setDesktopWindowFocused(windowState.focused)
          setDesktopWindowAlwaysOnTop(windowState.alwaysOnTop)
          setDesktopWindowFullscreen(windowState.fullscreen)
          setDesktopWindowGeometry(geometry)
          window.localStorage.setItem(
            DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY,
            JSON.stringify(geometry)
          )
          stopStateSync = unlistenState
          stopGeometrySync = unlistenGeometry
        } else {
          unlistenState()
          unlistenGeometry()
        }
      } catch {
        if (!cancelled) {
          setDesktopRuntime(null)
          setDesktopWindowMaximized(null)
          setDesktopWindowFocused(null)
          setDesktopWindowAlwaysOnTop(null)
          setDesktopWindowFullscreen(null)
          setDesktopWindowGeometry(null)
        }
      }
    }

    void loadDesktopRuntime()

    return () => {
      cancelled = true
      stopStateSync?.()
      stopGeometrySync?.()
    }
  }, [])

  function focusRelativeChat(offset: number) {
    const navigableChats = visibleChatItems

    if (navigableChats.length === 0) {
      return
    }

    const currentIndex = activeChat
      ? navigableChats.findIndex((chat) => chat.id === activeChat.id)
      : 0
    const safeIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = (safeIndex + offset + navigableChats.length) % navigableChats.length
    const nextChat = navigableChats[nextIndex]

    setActiveChatId(nextChat.id)

    window.requestAnimationFrame(() => {
      chatButtonRefs.current[nextChat.id]?.focus()
    })
  }

  const handleDesktopShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (view !== 'chat') {
      return
    }

    const hasModifier = event.metaKey || event.ctrlKey
    const typingTarget = isEditableTarget(event.target)

    if (event.key === 'Escape') {
      setBanner(null)

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }

      return
    }

    if (!typingTarget && !hasModifier && event.key === '/' && activeChat) {
      event.preventDefault()
      draftInputRef.current?.focus()
      return
    }

    if (!typingTarget && !hasModifier && event.altKey) {
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusRelativeChat(-1)
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusRelativeChat(1)
        return
      }
    }

    if (!hasModifier) {
      return
    }

    if ((event.key === '\\' || event.code === 'Backslash') && !event.shiftKey) {
      event.preventDefault()
      setDetailRailPreferred((current) => !current)
      return
    }

    if (isDesktopShell() && event.shiftKey) {
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault()
        void handleMinimizeDesktopHostWindow()
        return
      }

      if (event.code === 'Digit0') {
        event.preventDefault()
        void handleResetDesktopHostWindowFrame()
        return
      }

      if (event.key.toLowerCase() === 'p') {
        event.preventDefault()
        void handleToggleDesktopAlwaysOnTop()
        return
      }

      if (event.key.toLowerCase() === 'u') {
        event.preventDefault()
        void handleToggleDesktopFullscreen()
        return
      }

      if (event.key.toLowerCase() === 'd') {
        event.preventDefault()
        void handleCopyDesktopDiagnostics()
        return
      }

      if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        void handleCloseDesktopHostWindow()
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        void handleToggleDesktopWindowMaximize()
        return
      }
    }

    if (event.key.toLowerCase() === 'f' && event.shiftKey) {
      event.preventDefault()
      chatFilterInputRef.current?.focus()
      chatFilterInputRef.current?.select()
      return
    }

    if (event.key.toLowerCase() === 'k' && !event.shiftKey) {
      event.preventDefault()
      directChatInputRef.current?.focus()
      directChatInputRef.current?.select()
      return
    }

    if (event.key.toLowerCase() === 'g' && event.shiftKey) {
      event.preventDefault()
      groupTitleInputRef.current?.focus()
      groupTitleInputRef.current?.select()
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      if (draft.trim() !== '' && activeChat && !loading) {
        event.preventDefault()
        void sendDraftMessage()
      }

      return
    }

    if (event.shiftKey && !loading && activeChat && !activeCall) {
      if (event.key.toLowerCase() === 'a') {
        event.preventDefault()
        void handleStartCall('voice')
        return
      }

      if (event.key.toLowerCase() === 'v') {
        event.preventDefault()
        void handleStartCall('video')
      }
    }
  })

  useEffect(() => {
    window.addEventListener('keydown', handleDesktopShortcut)

    return () => {
      window.removeEventListener('keydown', handleDesktopShortcut)
    }
  }, [])

  async function handleCreateDirectChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!storedDevice) {
      return
    }

    setLoading(true)

    try {
      const response = await createDirectChat(storedDevice.sessionToken, newChatUsername)
      setChatItems((current) => mergeChat(current, response.chat))
      setActiveChatId(response.chat.id)
      setBanner({ tone: 'success', message: `Direct chat ready: ${response.chat.title}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create direct chat.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateGroupChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!storedDevice || newGroupTitle.trim() === '') {
      return
    }

    setLoading(true)

    try {
      const members = newGroupMembers
        .split(',')
        .map((member) => member.trim())
        .filter(Boolean)
      const response = await createGroupChat(storedDevice.sessionToken, {
        title: newGroupTitle.trim(),
        members
      })

      setChatItems((current) => mergeChat(current, response.chat))
      setActiveChatId(response.chat.id)
      setNewGroupTitle('')
      setNewGroupMembers('')
      setBanner({ tone: 'success', message: `Group ready: ${response.chat.title}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create group chat.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

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

  async function handleJoinActiveCall() {
    if (!storedDevice || !activeCall) {
      return
    }

    const sessionToken = storedDevice.sessionToken
    const trackKind = activeCall.mode === 'voice' ? 'audio' : 'audio_video'
    setLoading(true)

    try {
      const response = await joinCallSession(sessionToken, activeCall.id, {
        track_kind: trackKind
      })
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

  async function handleLeaveActiveCall() {
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

  async function handleProvisionMembraneWebRtcEndpoint() {
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

  async function handlePollMembraneWebRtcEndpoint() {
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

      const bridgeSignals = response.media_events
        .map((eventPayload) => parseMembraneBridgeSignal(eventPayload))
        .filter((signal): signal is CallSignal => signal !== null)

      if (bridgeSignals.length > 0) {
        let nextSignals = callSignalsRef.current

        for (const signal of bridgeSignals) {
          const seen = nextSignals.some((candidate) => candidate.id === signal.id)
          nextSignals = mergeCallSignals(nextSignals, signal)

          if (
            !seen &&
            signal.call_id === activeCall.id &&
            signal.from_device_id !== storedDevice.deviceId
          ) {
            void processCallSignalForWebRtc(signal)
          }
        }

        callSignalsRef.current = nextSignals
        setCallSignals(nextSignals)
      }

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

  async function handlePingMembraneWebRtcEndpoint() {
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

  async function emitCallSignalPayload(
    signalType: CallSignal['signal_type'],
    payload: string
  ): Promise<CallSignal | null> {
    if (!storedDevice || !activeCall) {
      return null
    }

    const sessionToken = storedDevice.sessionToken
    const targetDeviceId =
      callSignalTargetDeviceId === CALL_SIGNAL_BROADCAST ? undefined : callSignalTargetDeviceId

    const response = await sendCallSignal(sessionToken, activeCall.id, {
      signal_type: signalType,
      payload,
      target_device_id: targetDeviceId
    })

    const nextSignals = mergeCallSignals(callSignalsRef.current, response.signal)
    callSignalsRef.current = nextSignals
    setCallSignals(nextSignals)
    return response.signal
  }

  async function handleInitializeWebRtc() {
    if (!activeCall || !storedDevice) {
      return
    }

    setLoading(true)

    try {
      const peer = ensureWebRtcLab()
      setWebRtcLocalDescription(readDescriptionPayload(peer))
      setWebRtcRemoteDescription(readRemoteDescriptionPayload(peer))
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
          'Browser WebRTC lab initialized, the Membrane client is ready, and a native connect event was sent.'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize WebRTC.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleRefreshDesktopRuntime() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Desktop runtime details are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      const [runtime, windowState] = await Promise.all([
        fetchDesktopRuntimeInfo(),
        fetchDesktopWindowState()
      ])
      setDesktopRuntime(runtime)
      setDesktopWindowMaximized(windowState.maximized)
      setDesktopWindowFocused(windowState.focused)
      setDesktopWindowAlwaysOnTop(windowState.alwaysOnTop)
      setDesktopWindowFullscreen(windowState.fullscreen)
      setBanner({ tone: 'success', message: 'Desktop runtime details refreshed.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh desktop runtime info.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleDesktopWindowMaximize() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Window controls are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      const nextState = await toggleDesktopWindowMaximize()
      setDesktopWindowMaximized(nextState)
      setBanner({
        tone: 'success',
        message: nextState ? 'Desktop window maximized.' : 'Desktop window restored.'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to toggle the desktop window state.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleMinimizeDesktopHostWindow() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Window controls are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      await minimizeDesktopWindow()
      setBanner({ tone: 'success', message: 'Desktop window minimized.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to minimize the desktop window.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleCloseDesktopHostWindow() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Window controls are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      await closeDesktopWindow()
      setBanner({ tone: 'success', message: 'Desktop window close requested.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to close the desktop window.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleDesktopAlwaysOnTop() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Window controls are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      const nextState = await toggleDesktopWindowAlwaysOnTop()
      setDesktopWindowAlwaysOnTop(nextState)
      setBanner({
        tone: 'success',
        message: nextState ? 'Desktop window pinned on top.' : 'Desktop window returned to normal stacking.'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update always-on-top state.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleDesktopFullscreen() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Window controls are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      const nextState = await toggleDesktopWindowFullscreen()
      setDesktopWindowFullscreen(nextState)
      setBanner({
        tone: 'success',
        message: nextState ? 'Desktop window entered fullscreen.' : 'Desktop window exited fullscreen.'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to toggle fullscreen mode.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleCopyDesktopDiagnostics() {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setBanner({ tone: 'error', message: 'Clipboard access is not available in this environment.' })
      return
    }

    setLoading(true)

    try {
      const diagnostics = {
        capturedAt: new Date().toISOString(),
        desktopShell: isDesktopShell(),
        desktopRuntime,
        windowState: {
          maximized: desktopWindowMaximized,
          focused: desktopWindowFocused,
          alwaysOnTop: desktopWindowAlwaysOnTop,
          fullscreen: desktopWindowFullscreen
        },
        windowGeometry: desktopWindowGeometry,
        nativeTitle: desktopWindowTitle,
        layout: {
          detailRailPreferred,
          detailRailVisible,
          isDesktopWide
        },
        activeContext: {
          activeChatId: activeChat?.id ?? null,
          activeChatTitle: activeChat?.title ?? null,
          activeCallId: activeCall?.id ?? null,
          activeCallMode: activeCall?.mode ?? null
        }
      }

      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
      setBanner({ tone: 'success', message: 'Desktop diagnostics copied to the clipboard.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to copy desktop diagnostics.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleResetDesktopHostWindowFrame() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Window controls are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      const geometry = await resetDesktopWindowGeometry()
      setDesktopWindowGeometry(geometry)
      setDesktopWindowMaximized(false)
      setDesktopWindowFullscreen(false)
      window.localStorage.setItem(
        DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY,
        JSON.stringify(geometry)
      )
      setBanner({
        tone: 'success',
        message: `Desktop window frame reset to ${geometry.width}×${geometry.height} and recentered.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset the desktop window frame.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateWebRtcOffer() {
    if (!activeCall) {
      return
    }

    if (membraneClientConnected) {
      setBanner({
        tone: 'info',
        message:
          'The native Membrane client now drives negotiation. Create Offer is only needed when you are debugging the fallback browser-only path.'
      })
      return
    }

    setLoading(true)

    try {
      const peer = ensureWebRtcLab()
      const offerPayload = await createOfferPayload(peer)
      setWebRtcLocalDescription(readDescriptionPayload(peer))
      await emitCallSignalPayload('offer', offerPayload)
      setBanner({ tone: 'success', message: 'Offer created from a real RTCPeerConnection and sent.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create an SDP offer.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleAttachLocalMedia(mode: 'audio' | 'audio_video') {
    if (!activeCall) {
      return
    }

    setLoading(true)

    try {
      const peer = ensureWebRtcLab()
      const result = await attachLocalMediaTracks(
        peer,
        mode === 'audio'
          ? { audio: true, video: false }
          : {
              audio: true,
              video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
              }
            },
        localMediaStreamRef.current
      )

      localMediaStreamRef.current = result.stream
      if (membraneClientRef.current && membraneClientConnected) {
        await removeLocalTracksFromMembrane(membraneClientRef.current, membraneLocalTrackIdsRef.current)
        membraneLocalTrackIdsRef.current = []
      }
      setLocalMediaMode(mode)
      setLocalMediaRevision((current) => current + 1)
      setLocalAudioTrackCount(result.audioTrackCount)
      setLocalVideoTrackCount(result.videoTrackCount)
      setBanner({
        tone: 'success',
        message:
          mode === 'audio'
            ? membraneClientRef.current
              ? 'Microphone attached to both the browser lab and the Membrane client. Create a fresh offer if you are still using the fallback lab path.'
              : 'Microphone attached to the browser WebRTC lab. Create a fresh offer to renegotiate.'
            : membraneClientRef.current
              ? 'Camera and microphone attached to both the browser lab and the Membrane client. Create a fresh offer if you are still using the fallback lab path.'
              : 'Camera and microphone attached to the browser WebRTC lab. Create a fresh offer to renegotiate.'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to attach local media.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleReleaseLocalMedia() {
    await removeLocalTracksFromMembrane(membraneClientRef.current, membraneLocalTrackIdsRef.current)
    membraneLocalTrackIdsRef.current = []
    detachLocalMediaTracks(peerConnectionRef.current, localMediaStreamRef.current)
    localMediaStreamRef.current = null
    setLocalMediaMode('none')
    setLocalMediaRevision((current) => current + 1)
    setLocalAudioTrackCount(0)
    setLocalVideoTrackCount(0)
    setBanner({
      tone: 'success',
      message: 'Local microphone/camera tracks were removed from the browser WebRTC lab and the Membrane client.'
    })
  }

  async function handleSendCallSignal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!storedDevice || !activeCall || callSignalPayload.trim() === '') {
      return
    }

    if (membraneClientConnected) {
      setBanner({
        tone: 'info',
        message:
          'Manual offer/answer/ICE signaling is disabled while the native Membrane client is active.'
      })
      return
    }

    setLoading(true)

    try {
      await emitCallSignalPayload(callSignalType, callSignalPayload.trim())

      if (callSignalType === 'offer') {
        setCallSignalType('answer')
        setCallSignalPayload('{"type":"answer","sdp":"stub-answer"}')
      } else if (callSignalType === 'answer') {
        setCallSignalType('ice')
        setCallSignalPayload('{"candidate":"candidate:stub","sdpMid":"0","sdpMLineIndex":0}')
      } else {
        setCallSignalPayload('')
      }

      setBanner({
        tone: 'success',
        message:
          callSignalTargetDeviceId === CALL_SIGNAL_BROADCAST
            ? `${callSignalType} signal sent to joined peer endpoints.`
            : `${callSignalType} signal sent to ${callSignalTargetDeviceId}.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send the call signal.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function buildEncryptedMessagePayload(
    plainText: string,
    chatId: string,
    clientId: string,
    messageKind: 'text' | 'attachment',
    replyToMessageId?: string | null
  ) {
    if (!storedDevice) {
      throw new Error('No local device identity is available.')
    }

    const recipientDeviceResponse = await listRecipientDevices(storedDevice.sessionToken, chatId)
    const recipientDevices = recipientDeviceResponse.recipient_devices
    const sessions = await syncChatSessionsFromServer(chatId, recipientDevices)
    const canUseSessionEncryption = canUseChatSessions(storedDevice, sessions, recipientDevices)
    const canUseRecipientWrapping = shouldUseRecipientWrapping(storedDevice, recipientDevices)
    const payload = canUseRecipientWrapping
      ? canUseSessionEncryption
        ? {
            client_id: clientId,
            message_kind: messageKind,
            ...(await encryptMessageWithSessions(plainText, storedDevice.deviceId, sessions))
          }
        : {
            client_id: clientId,
            message_kind: messageKind,
            ...(await encryptMessageEnvelope(plainText, recipientDevices))
          }
      : {
          client_id: clientId,
          ciphertext: await encryptLegacyMessageText(plainText),
          message_kind: messageKind
        }

    return {
      payload: replyToMessageId ? { ...payload, reply_to_message_id: replyToMessageId } : payload,
      deliveryMode: canUseSessionEncryption
        ? 'session'
        : canUseRecipientWrapping
          ? 'recipient'
          : 'legacy'
    } as const
  }

  async function sendDraftMessage() {
    if (!storedDevice || !activeChatId || draft.trim() === '') {
      return
    }

    setLoading(true)

    const plainText = draft.trim()
    const clientId = window.crypto.randomUUID()
    const optimisticId = `optimistic-${clientId}`
    const activeReplyToMessageId = replyTargetMessageId
    const optimisticMessage: CachedMessage = {
      id: optimisticId,
      clientId,
      replyToMessageId: activeReplyToMessageId ?? undefined,
      text: plainText,
      sentAt: new Date().toISOString(),
      side: 'outgoing',
      decryptable: true
    }

    replaceActiveMessages(activeChatId, mergeMessageThread(messageItemsRef.current, optimisticMessage), true)
    setDraft('')
    setReplyTargetMessageId(null)

    try {
      const { payload, deliveryMode } = await buildEncryptedMessagePayload(
        plainText,
        activeChatId,
        clientId,
        'text',
        activeReplyToMessageId
      )

      const response = await createMessage(storedDevice.sessionToken, activeChatId, payload)

      await ingestMessageIntoActiveThread(response.message, activeChatId)
      setBanner({
        tone: 'success',
        message: deliveryMode === 'session'
          ? 'Session-bootstrapped encrypted envelope delivered to the server.'
          : deliveryMode === 'recipient'
            ? 'Recipient-wrapped encrypted envelope delivered to the server.'
            : 'Legacy local encrypted envelope delivered to the server.'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message.'
      setBanner({ tone: 'error', message })
      setDraft(plainText)
      setReplyTargetMessageId(activeReplyToMessageId)
      replaceActiveMessages(
        activeChatId,
        messageItemsRef.current.filter((item) => item.clientId !== clientId && item.id !== optimisticId),
        true
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await sendDraftMessage()
  }

  async function handleAttachmentPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !storedDevice || !activeChatId) {
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: 'Encrypting and uploading attachment…' })

    const clientId = window.crypto.randomUUID()
    const optimisticId = `optimistic-${clientId}`
    const activeReplyToMessageId = replyTargetMessageId
    let thumbnailDataUrl: string | null = null

    try {
      thumbnailDataUrl = await generateAttachmentThumbnailDataUrl(file)
    } catch {
      thumbnailDataUrl = null
    }

    const optimisticAttachment = {
      uploadId: 'pending',
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      thumbnailDataUrl: thumbnailDataUrl ?? undefined
    }
    const optimisticMessage: CachedMessage = {
      id: optimisticId,
      clientId,
      replyToMessageId: activeReplyToMessageId ?? undefined,
      text: `Attachment: ${file.name}`,
      sentAt: new Date().toISOString(),
      side: 'outgoing',
      decryptable: true,
      attachment: optimisticAttachment
    }

    replaceActiveMessages(activeChatId, mergeMessageThread(messageItemsRef.current, optimisticMessage), true)
    setReplyTargetMessageId(null)

    try {
      const encryptedAttachment = await encryptAttachmentFile(file)
      const createUploadResponse = await createMediaUpload(storedDevice.sessionToken, {
        filename: file.name,
        content_type: encryptedAttachment.contentType,
        declared_byte_size: encryptedAttachment.size,
        media_kind: inferMediaKind(file.type)
      })
      const uploadId = createUploadResponse.upload.id

      await appendMediaUploadPart(storedDevice.sessionToken, uploadId, encryptedAttachment.ciphertextBase64)
      await completeMediaUpload(storedDevice.sessionToken, uploadId)

      const descriptor: AttachmentDescriptor = {
        kind: 'attachment',
        uploadId,
        fileName: file.name,
        contentType: encryptedAttachment.contentType,
        size: encryptedAttachment.size,
        thumbnailDataUrl: thumbnailDataUrl ?? undefined,
        contentKeyBase64: encryptedAttachment.contentKeyBase64,
        ivBase64: encryptedAttachment.ivBase64
      }

      const { payload, deliveryMode } = await buildEncryptedMessagePayload(
        JSON.stringify(descriptor),
        activeChatId,
        clientId,
        'attachment',
        activeReplyToMessageId
      )
      const response = await createMessage(storedDevice.sessionToken, activeChatId, payload)

      await ingestMessageIntoActiveThread(response.message, activeChatId)
      setBanner({
        tone: 'success',
        message:
          deliveryMode === 'session'
            ? 'Encrypted attachment uploaded and delivered with session transport.'
            : deliveryMode === 'recipient'
              ? 'Encrypted attachment uploaded and delivered with recipient wrapping.'
              : 'Encrypted attachment uploaded and delivered with legacy local transport.'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send attachment.'
      setBanner({ tone: 'error', message })
      setReplyTargetMessageId(activeReplyToMessageId)
      replaceActiveMessages(
        activeChatId,
        messageItemsRef.current.filter((item) => item.clientId !== clientId && item.id !== optimisticId),
        true
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleDownloadAttachment(attachment: AttachmentDescriptor) {
    if (!storedDevice) {
      setBanner({ tone: 'error', message: 'No local device identity is available.' })
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: `Downloading ${attachment.fileName}…` })

    try {
      const response = await fetchMediaUpload(storedDevice.sessionToken, attachment.uploadId)

      if (!response.upload.ciphertext) {
        throw new Error('The encrypted attachment payload is missing on the server.')
      }

      const blob = await decryptAttachmentFile(
        response.upload.ciphertext,
        attachment.contentKeyBase64,
        attachment.ivBase64,
        attachment.contentType
      )
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = attachment.fileName
      anchor.click()
      URL.revokeObjectURL(url)

      setBanner({ tone: 'success', message: `${attachment.fileName} downloaded and decrypted.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download attachment.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleQuickReaction(reactionKey: string) {
    if (!storedDevice || !activeChatId) {
      return
    }

    const targetMessage = [...messageItemsRef.current]
      .reverse()
      .find((message) => !message.id.startsWith('optimistic-'))

    if (!targetMessage) {
      setBanner({ tone: 'info', message: 'Send a message before adding reactions.' })
      return
    }

    setLoading(true)

    try {
      const response = await toggleMessageReaction(
        storedDevice.sessionToken,
        activeChatId,
        targetMessage.id,
        reactionKey
      )

      await ingestMessageIntoActiveThread(response.message, activeChatId)
      setBanner({ tone: 'success', message: `Reaction ${reactionKey} updated on the latest message.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update reaction.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  function handleReplyToMessage(message: CachedMessage) {
    if (message.side === 'system') {
      return
    }

    setReplyTargetMessageId(message.id)
    draftInputRef.current?.focus()
  }

  function replaceActiveMessages(chatId: string, nextMessages: CachedMessage[], syncSummary: boolean) {
    if (activeChatIdRef.current !== chatId) {
      return
    }

    messageItemsRef.current = nextMessages
    setMessageItems(nextMessages)
    void writeCachedMessages(chatId, nextMessages)

    if (syncSummary) {
      setChatItems((current) => syncChatSummary(current, chatId, nextMessages))
    }
  }

  async function ingestMessageIntoActiveThread(message: ChatMessage, chatId: string) {
    if (!storedDevice || activeChatIdRef.current !== chatId) {
      return
    }

    const projected = await projectMessage(
      message,
      storedDevice.deviceId,
      storedDevice.encryptionPrivateKeyPkcs8Base64
    )

    if (activeChatIdRef.current !== chatId) {
      return
    }

    replaceActiveMessages(chatId, mergeMessageThread(messageItemsRef.current, projected), true)
  }

  const onboarding = view !== 'chat'
  const normalizedChatFilter = chatFilter.trim().toLowerCase()
  const visibleChatItems =
    normalizedChatFilter === ''
      ? chatItems
      : chatItems.filter((chat) => chat.title.toLowerCase().includes(normalizedChatFilter))
  const detailRailVisible = detailRailPreferred && isDesktopWide
  const desktopShell = isDesktopShell()
  const activeChat =
    chatItems.find((chat) => chat.id === deferredActiveChatId) ?? chatItems[0] ?? null
  const replyTargetMessage =
    replyTargetMessageId
      ? messageItems.find((message) => message.id === replyTargetMessageId) ?? null
      : null
  const desktopWindowTitle = buildDesktopWindowTitle(activeChat?.title ?? null, activeCall?.mode ?? null)
  const appShellClassName = detailRailVisible ? 'app-shell' : 'app-shell app-shell--detail-hidden'
  const dominantRemoteEndpointId = pickDominantRemoteSpeakerEndpointId(membraneRemoteTracks)
  const featuredRemoteTrack = pickFeaturedRemoteTrack(membraneRemoteTracks, dominantRemoteEndpointId)
  const dominantRemoteEndpoint = dominantRemoteEndpointId
    ? membraneRemoteEndpoints.find((endpoint) => endpoint.id === dominantRemoteEndpointId) ?? null
    : null

  useEffect(() => {
    if (!desktopShell) {
      return
    }

    let cancelled = false

    async function syncDesktopTitle() {
      try {
        await setDesktopWindowTitle(desktopWindowTitle)
      } catch {
        if (!cancelled) {
          // Ignore transient desktop title sync failures.
        }
      }
    }

    void syncDesktopTitle()

    return () => {
      cancelled = true
    }
  }, [desktopShell, desktopWindowTitle])

  if (onboarding) {
    return (
      <div className="auth-shell">
        <section className="auth-shell__hero">
          <span className="sidebar__eyebrow">Vostok Stage 2</span>
          <h1>Identity and device bootstrap</h1>
          <p>
            This slice adds real registration, challenge-response authentication, and local device
            key storage in the browser.
          </p>

          <MessageBubble className="conversation-stage__hero" side="system">
            <strong className="hero-card__title">Private by default</strong>
            <span className="hero-card__copy">
              Your browser now generates local signing and encryption keys. The server stores only
              the public halves and later verifies challenge signatures during login.
            </span>
            <span className="hero-card__mark" aria-hidden="true">
              V
            </span>
          </MessageBubble>
        </section>

        <GlassSurface className="auth-card">
          <div className="auth-card__tabs">
            <button
              className={view === 'register' ? 'auth-tab auth-tab--active' : 'auth-tab'}
              type="button"
              onClick={() => setView('register')}
            >
              Register
            </button>
            <button
              className={view === 'login' ? 'auth-tab auth-tab--active' : 'auth-tab'}
              type="button"
              onClick={() => setView('login')}
            >
              Sign In
            </button>
            <button
              className={view === 'link' ? 'auth-tab auth-tab--active' : 'auth-tab'}
              type="button"
              onClick={() => setView('link')}
            >
              Link Device
            </button>
          </div>

          {banner ? (
            <div className={`status-banner status-banner--${banner.tone}`}>{banner.message}</div>
          ) : null}

          {view === 'welcome' || view === 'register' ? (
            <form className="auth-form" onSubmit={handleRegister}>
              <div className="auth-copy">
                <h2>Create your first device</h2>
                <p>
                  This flow creates a local device key, registers a username, and stores the issued
                  session token in local browser storage.
                </p>
              </div>

              <label className="auth-field">
                <span>Username</span>
                <input
                  autoComplete="username"
                  disabled={loading}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="grigory"
                  required
                  value={username}
                />
              </label>

              <label className="auth-field">
                <span>Device name</span>
                <input
                  disabled={loading}
                  onChange={(event) => setDeviceName(event.target.value)}
                  placeholder="Safari on Mac"
                  required
                  value={deviceName}
                />
              </label>

              <button className="primary-action" disabled={loading} type="submit">
                {loading ? 'Working…' : 'Register This Device'}
              </button>
            </form>
          ) : null}

          {view === 'login' ? (
            <div className="auth-form">
              <div className="auth-copy">
                <h2>Re-authenticate on this browser</h2>
                <p>
                  This uses the stored private key to sign a fresh server challenge and mint a new
                  session token.
                </p>
              </div>

              <div className="device-summary-card">
                {storedDevice ? (
                  <>
                    <strong>{storedDevice.username}</strong>
                    <span>{storedDevice.deviceName}</span>
                    <span>Device ID: {storedDevice.deviceId}</span>
                  </>
                ) : (
                  <>
                    <strong>No local device found</strong>
                    <span>Register once on this browser before using sign-in.</span>
                  </>
                )}
              </div>

              <button
                className="primary-action"
                disabled={loading || !storedDevice}
                onClick={handleReauthenticate}
                type="button"
              >
                {loading ? 'Working…' : 'Sign Challenge'}
              </button>
            </div>
          ) : null}

          {view === 'link' ? (
            <div className="auth-form">
              <div className="auth-copy">
                <h2>Link a second device</h2>
                <p>
                  The full QR-based pairing flow lands in the next slice. This screen reserves the
                  Stage 2 entry point so the UX is in place before the pairing transport is added.
                </p>
              </div>

              <label className="auth-field">
                <span>Pairing code</span>
                <input disabled placeholder="Coming next" value="" readOnly />
              </label>

              <button className="secondary-action" disabled type="button">
                Pairing Transport Pending
              </button>
            </div>
          ) : null}
        </GlassSurface>
      </div>
    )
  }

  return (
    <div className={appShellClassName}>
      <aside className="sidebar">
        <div className="sidebar__header">
          <span className="sidebar__eyebrow">Vostok</span>
          {desktopShell ? (
            <div
              className={
                desktopWindowFocused === false
                  ? 'desktop-titlebar desktop-titlebar--inactive'
                  : 'desktop-titlebar'
              }
            >
              <div className="desktop-titlebar__meta" data-tauri-drag-region>
                <strong>{desktopRuntime?.appName ?? 'Vostok Desktop'}</strong>
                <span>
                  {desktopRuntime
                    ? `${desktopRuntime.platform}/${desktopRuntime.arch}`
                    : 'Tauri desktop host'}
                </span>
              </div>
              <div className="desktop-titlebar__actions">
                <button
                  aria-label={desktopWindowAlwaysOnTop ? 'Disable always on top' : 'Enable always on top'}
                  className="vostok-icon-button desktop-titlebar__button"
                  disabled={loading}
                  onClick={handleToggleDesktopAlwaysOnTop}
                  type="button"
                >
                  <span className="vostok-icon-button__glyph">
                    {desktopWindowAlwaysOnTop ? 'P' : 'p'}
                  </span>
                </button>
                <button
                  aria-label={desktopWindowFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  className="vostok-icon-button desktop-titlebar__button"
                  disabled={loading}
                  onClick={handleToggleDesktopFullscreen}
                  type="button"
                >
                  <span className="vostok-icon-button__glyph">
                    {desktopWindowFullscreen ? 'U' : 'u'}
                  </span>
                </button>
                <button
                  aria-label="Minimize desktop window"
                  className="vostok-icon-button desktop-titlebar__button"
                  disabled={loading}
                  onClick={handleMinimizeDesktopHostWindow}
                  type="button"
                >
                  <span className="vostok-icon-button__glyph">-</span>
                </button>
                <button
                  aria-label={desktopWindowMaximized ? 'Restore desktop window' : 'Maximize desktop window'}
                  className="vostok-icon-button desktop-titlebar__button"
                  disabled={loading}
                  onClick={handleToggleDesktopWindowMaximize}
                  type="button"
                >
                  <span className="vostok-icon-button__glyph">
                    {desktopWindowMaximized ? 'R' : '+'}
                  </span>
                </button>
                <button
                  aria-label="Close desktop window"
                  className="vostok-icon-button desktop-titlebar__button"
                  disabled={loading}
                  onClick={handleCloseDesktopHostWindow}
                  type="button"
                >
                  <span className="vostok-icon-button__glyph">x</span>
                </button>
              </div>
            </div>
          ) : null}
          <h1>Chats</h1>
          <p>Stage 3 now uses authenticated direct chats and opaque encrypted message envelopes.</p>
        </div>
        <button
          aria-pressed={detailRailVisible}
          className="secondary-action detail-rail-toggle"
          onClick={() => setDetailRailPreferred((current) => !current)}
          type="button"
        >
          {detailRailVisible
            ? 'Hide Detail Rail'
            : isDesktopWide
              ? 'Show Detail Rail'
              : 'Detail Rail Hidden on Narrow Window'}
        </button>
        <div className="new-chat-form">
          <label className="auth-field">
            <span>Filter chats</span>
            <input
              disabled={loading}
              onChange={(event) => setChatFilter(event.target.value)}
              placeholder="Search by title"
              ref={chatFilterInputRef}
              value={chatFilter}
            />
          </label>
          {chatFilter.trim() !== '' ? (
            <button
              className="secondary-action"
              disabled={loading}
              onClick={() => setChatFilter('')}
              type="button"
            >
              Clear Filter
            </button>
          ) : null}
        </div>
        <form className="new-chat-form" onSubmit={handleCreateDirectChat}>
          <label className="auth-field">
            <span>Start direct chat</span>
            <input
              disabled={loading}
              onChange={(event) => setNewChatUsername(event.target.value)}
              placeholder="username"
              ref={directChatInputRef}
              value={newChatUsername}
            />
          </label>
          <button className="secondary-action" disabled={loading || newChatUsername.trim() === ''} type="submit">
            Open Direct Chat
          </button>
        </form>
        <form className="new-chat-form" onSubmit={handleCreateGroupChat}>
          <label className="auth-field">
            <span>Create group</span>
            <input
              disabled={loading}
              onChange={(event) => setNewGroupTitle(event.target.value)}
              placeholder="Operators"
              ref={groupTitleInputRef}
              value={newGroupTitle}
            />
          </label>
          <label className="auth-field">
            <span>Members (comma-separated)</span>
            <input
              disabled={loading}
              onChange={(event) => setNewGroupMembers(event.target.value)}
              placeholder="alice,bob"
              value={newGroupMembers}
            />
          </label>
          <button className="secondary-action" disabled={loading || newGroupTitle.trim() === ''} type="submit">
            Open Group
          </button>
        </form>
        <div className="sidebar__list">
          {visibleChatItems.length > 0 ? (
            visibleChatItems.map((chat) => (
              <button
                key={chat.id}
                className="chat-list-button"
                onClick={() => setActiveChatId(chat.id)}
                ref={(element) => {
                  chatButtonRefs.current[chat.id] = element
                }}
                type="button"
              >
                <ChatListItem
                  title={chat.title}
                  preview={
                    chat.message_count > 0
                      ? `${chat.message_count} encrypted ${chat.message_count === 1 ? 'message' : 'messages'}`
                      : 'No messages yet'
                  }
                  timestamp={formatRelativeTime(chat.latest_message_at)}
                  unreadCount={chat.message_count > 0 ? Math.min(chat.message_count, 9) : undefined}
                  active={chat.id === activeChat?.id}
                  pinned={chat.is_self_chat}
                />
              </button>
            ))
          ) : (
            <span className="settings-card__muted">No chats match the current filter.</span>
          )}
        </div>
      </aside>

      <main className="conversation-pane">
        {banner ? <div className={`status-banner status-banner--${banner.tone}`}>{banner.message}</div> : null}
        <ConversationHeader
          title={activeChat?.title ?? 'No active chat'}
          subtitle={
            activeChat
              ? activeChat.is_self_chat
                ? 'local encrypted cache available'
                : 'direct chat envelope transport'
              : 'create or select a direct chat'
          }
        />

        <section className="conversation-stage">
          {messageItems.length === 0 ? (
            <MessageBubble className="conversation-stage__hero" side="system">
              <strong className="hero-card__title">No messages here yet...</strong>
              <span className="hero-card__copy">
                Stage 3 now supports recipient-targeted envelope wrapping for newly registered
                devices, with a legacy local-cache fallback for older browser-only messages.
              </span>
              <span className="hero-card__mark" aria-hidden="true">
                V
              </span>
            </MessageBubble>
          ) : (
            <div className="message-thread">
              {messageItems.map((message) => (
                <MessageBubble key={message.id} side={message.side}>
                  {message.replyToMessageId ? (
                    <span className="message-thread__reply-preview">
                      Replying to {resolveReplyPreview(messageItems, message.replyToMessageId)}
                    </span>
                  ) : null}
                  <strong>{message.text}</strong>
                  {message.attachment?.thumbnailDataUrl ? (
                    <img
                      alt={message.attachment.fileName}
                      className="message-thread__attachment-preview"
                      src={message.attachment.thumbnailDataUrl}
                    />
                  ) : null}
                  {message.attachment?.contentKeyBase64 && message.attachment.ivBase64 ? (
                    <button
                      className="secondary-action"
                      onClick={() => handleDownloadAttachment(toAttachmentDescriptor(message.attachment!))}
                      type="button"
                    >
                      Download {message.attachment.fileName}
                    </button>
                  ) : null}
                  {message.reactions && message.reactions.length > 0 ? (
                    <span className="message-thread__reactions">
                      {message.reactions
                        .map((reaction) => `${reaction.reactionKey} ${reaction.count}${reaction.reacted ? '*' : ''}`)
                        .join(' • ')}
                    </span>
                  ) : null}
                  {message.side !== 'system' ? (
                    <button
                      className="secondary-action"
                      disabled={loading}
                      onClick={() => handleReplyToMessage(message)}
                      type="button"
                    >
                      Reply
                    </button>
                  ) : null}
                  <span className="message-thread__meta">
                    {formatRelativeTime(message.sentAt)}
                    {message.decryptable ? ' • decryptable on this device' : ' • opaque on this device'}
                  </span>
                </MessageBubble>
              ))}
            </div>
          )}

          <div className="floating-stack">
            <ReactionBar reactions={['ACK', 'OK', 'PLAN', 'SHIP']} onSelect={handleQuickReaction} />
            <ContextMenu
              actions={['Reply (next)', 'Forward (next)', 'Pin (next)', 'Delete for me', 'Delete for all']}
            />
          </div>
        </section>

        <form className="live-composer" onSubmit={handleSendMessage}>
          <input
            hidden
            onChange={handleAttachmentPick}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="vostok-icon-button"
            type="button"
            aria-label="Attach"
            disabled={loading || !activeChat}
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="vostok-icon-button__glyph">A</span>
          </button>
          <GlassSurface className="live-composer__field">
            {replyTargetMessageId ? (
              <div className="live-composer__reply">
                <div className="live-composer__reply-copy">
                  <strong>Replying</strong>
                  <span>{replyTargetMessage ? replyTargetMessage.text : 'Earlier message'}</span>
                </div>
                <button
                  className="vostok-icon-button live-composer__reply-clear"
                  disabled={loading}
                  onClick={() => setReplyTargetMessageId(null)}
                  type="button"
                >
                  <span className="vostok-icon-button__glyph">x</span>
                </button>
              </div>
            ) : null}
            <textarea
              className="live-composer__input"
              disabled={loading || !activeChat}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={activeChat ? 'Write an encrypted envelope…' : 'Create a chat first'}
              ref={draftInputRef}
              rows={1}
              value={draft}
            />
          </GlassSurface>
          <button
            className="primary-action live-composer__send"
            disabled={loading || !activeChat || draft.trim() === ''}
            type="submit"
          >
            Send
          </button>
        </form>
      </main>

      <aside className={detailRailVisible ? 'detail-rail' : 'detail-rail detail-rail--hidden'}>
        <ChatInfoPanel
          title={profileUsername ?? storedDevice?.username ?? 'Dinosaur'}
          phone="+7 999 555 01 10"
          handle={`@${profileUsername ?? storedDevice?.username ?? 'dinosaur'}`}
        />
        <GlassSurface className="settings-card">
          <div className="settings-card__header">
            <span className="sidebar__eyebrow">Settings</span>
            <h3>Current device</h3>
          </div>
          <div className="device-summary-card">
            <strong>{storedDevice?.deviceName ?? 'This browser'}</strong>
            <span>{storedDevice?.username ?? 'anonymous'}</span>
            <span>Session expires: {storedDevice?.sessionExpiresAt ?? 'not set'}</span>
            <span>
              Published prekeys:{' '}
              {storedDevice?.signedPrekeyPublicKeyBase64 ? 'signed prekey present' : 'signed prekey missing'}
              {` • ${storedDevice?.oneTimePrekeys?.length ?? 0} local one-time prekeys cached`}
            </span>
          </div>
          <div className="settings-card__actions">
            <button className="primary-action" disabled={loading} onClick={handleReauthenticate} type="button">
              Refresh Session
            </button>
            <button className="secondary-action" disabled={loading} onClick={handleRotatePrekeys} type="button">
              Rotate Prekeys
            </button>
            <button className="secondary-action" onClick={() => setView('link')} type="button">
              Link Another Device
            </button>
            <button className="danger-action" onClick={handleForgetDevice} type="button">
              Forget Local Device
            </button>
          </div>
        </GlassSurface>
        <GlassSurface className="settings-card">
          <div className="settings-card__header">
            <span className="sidebar__eyebrow">Desktop</span>
            <h3>Host bridge</h3>
          </div>
          <div className="device-summary-card">
            <strong>{isDesktopShell() ? 'Tauri desktop host detected' : 'Browser session'}</strong>
            <span>
              {desktopRuntime
                ? `${desktopRuntime.appName} ${desktopRuntime.appVersion} • ${desktopRuntime.platform}/${desktopRuntime.arch}`
                : isDesktopShell()
                  ? 'Runtime metadata available after the desktop host responds.'
                  : 'Desktop bridge commands are hidden until this UI runs inside the desktop wrapper.'}
            </span>
            <span>Native title: {desktopWindowTitle}</span>
            <span>
              {desktopRuntime
                ? desktopRuntime.debug
                  ? 'Desktop host is running in debug mode.'
                  : 'Desktop host is running in release mode.'
                : 'No desktop runtime metadata loaded yet.'}
            </span>
            <span>
              {desktopWindowMaximized === null
                ? 'Window state has not been toggled in this session yet.'
                : desktopWindowMaximized
                  ? 'Window is currently maximized.'
                  : 'Window is currently restored.'}
            </span>
            <span>
              {desktopWindowFocused === null
                ? 'Window focus state is not known yet.'
                : desktopWindowFocused
                  ? 'Window is currently focused.'
                  : 'Window is currently unfocused.'}
            </span>
            <span>
              {desktopWindowAlwaysOnTop === null
                ? 'Always-on-top state is not known yet.'
                : desktopWindowAlwaysOnTop
                  ? 'Window is pinned above other windows.'
                  : 'Window follows normal stacking order.'}
            </span>
            <span>Always-on-top preference is remembered across desktop launches.</span>
            <span>
              {desktopWindowFullscreen === null
                ? 'Fullscreen state is not known yet.'
                : desktopWindowFullscreen
                  ? 'Window is currently fullscreen.'
                  : 'Window is currently windowed.'}
            </span>
            <span>
              {desktopWindowGeometry
                ? `Window frame ${desktopWindowGeometry.width}×${desktopWindowGeometry.height} at ${desktopWindowGeometry.x}, ${desktopWindowGeometry.y}`
                : 'Window frame has not been captured yet.'}
            </span>
          </div>
          <div className="settings-card__actions">
            <button className="secondary-action" disabled={loading} onClick={handleRefreshDesktopRuntime} type="button">
              Refresh Host Info
            </button>
            <button className="secondary-action" disabled={loading} onClick={handleCopyDesktopDiagnostics} type="button">
              Copy Diagnostics
            </button>
            <button className="secondary-action" disabled={loading} onClick={handleToggleDesktopAlwaysOnTop} type="button">
              {desktopWindowAlwaysOnTop ? 'Disable Always On Top' : 'Enable Always On Top'}
            </button>
            <button className="secondary-action" disabled={loading} onClick={handleToggleDesktopFullscreen} type="button">
              {desktopWindowFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            </button>
            <button className="secondary-action" disabled={loading} onClick={handleToggleDesktopWindowMaximize} type="button">
              {desktopWindowMaximized ? 'Restore Window' : 'Toggle Maximize'}
            </button>
            <button className="secondary-action" disabled={loading} onClick={handleResetDesktopHostWindowFrame} type="button">
              Reset Window Frame
            </button>
            <button className="secondary-action" disabled={loading} onClick={handleMinimizeDesktopHostWindow} type="button">
              Minimize Window
            </button>
          </div>
        </GlassSurface>
        <GlassSurface className="settings-card">
          <div className="settings-card__header">
            <span className="sidebar__eyebrow">Stage 8</span>
            <h3>Desktop shortcuts</h3>
          </div>
          <div className="settings-card__list">
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>Compose</strong>
                <span>`/` focuses the active chat composer.</span>
              </div>
            </div>
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>Move between chats</strong>
                <span>`Alt+ArrowUp/Down` selects the previous or next chat.</span>
              </div>
            </div>
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>Filter chats</strong>
                <span>`Cmd/Ctrl+Shift+F` focuses the chat filter field.</span>
              </div>
            </div>
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>Toggle detail rail</strong>
                <span>`Cmd/Ctrl+\` switches between two-column and three-column desktop layout.</span>
              </div>
            </div>
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>Layout memory</strong>
                <span>
                  {isDesktopWide
                    ? `The saved desktop preference is currently ${detailRailPreferred ? 'expanded' : 'collapsed'}.`
                    : 'Your saved desktop rail preference is preserved while narrow windows force focus mode.'}
                </span>
              </div>
            </div>
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>Desktop host controls</strong>
                <span>`Cmd/Ctrl+Shift+P` always on top • `Cmd/Ctrl+Shift+U` fullscreen • `Cmd/Ctrl+Shift+D` diagnostics • `Cmd/Ctrl+Shift+M` minimize • `Cmd/Ctrl+Shift+Enter` maximize/restore • `Cmd/Ctrl+Shift+W` close</span>
              </div>
            </div>
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>Reset window frame</strong>
                <span>`Cmd/Ctrl+Shift+0` restores the default centered desktop frame.</span>
              </div>
            </div>
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>Diagnostics</strong>
                <span>The host card can copy runtime, window, and layout diagnostics to the clipboard, or use `Cmd/Ctrl+Shift+D`.</span>
              </div>
            </div>
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>Quick actions</strong>
                <span>`Cmd/Ctrl+K` direct chat • `Cmd/Ctrl+Shift+G` group title</span>
              </div>
            </div>
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>Send and call</strong>
                <span>`Cmd/Ctrl+Enter` send • `Cmd/Ctrl+Shift+A/V` voice or video call</span>
              </div>
            </div>
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>Reset focus</strong>
                <span>`Escape` clears the banner and blurs the active field.</span>
              </div>
            </div>
          </div>
        </GlassSurface>
        <GlassSurface className="settings-card">
          <div className="settings-card__header">
            <span className="sidebar__eyebrow">Stage 3</span>
            <h3>Messaging slice</h3>
          </div>
          <div className="device-summary-card">
            <strong>{activeChat?.title ?? 'No chat selected'}</strong>
            <span>{activeChat ? `${activeChat.message_count} server envelopes` : 'Open a direct chat'}</span>
            <span>
              {activeChat?.is_self_chat
                ? 'Self-chat can use recipient-wrapped envelopes when this device has an encryption key.'
                : 'Cross-user transport now advances a simple local ratchet from per-device session roots with explicit initiator ephemeral bootstrap; the full Signal-grade ratchet is still next.'}
            </span>
            <span>
              {activeChat
                ? `${remotePrekeyBundles.length} published prekey ${remotePrekeyBundles.length === 1 ? 'bundle' : 'bundles'} visible for this chat`
                : 'Select a chat to inspect published prekeys'}
            </span>
            <span>
              {activeChat
                ? `${chatSessions.length} cached direct-chat session ${chatSessions.length === 1 ? 'record' : 'records'} ready for this chat`
                : 'Select a chat to bootstrap direct-chat sessions'}
            </span>
          </div>
        </GlassSurface>
        <GlassSurface className="settings-card">
          <div className="settings-card__header">
            <span className="sidebar__eyebrow">Stage 6</span>
            <h3>Admin surface</h3>
          </div>
          <div className="device-summary-card">
            <strong>Local operator overview</strong>
            <span>
              {adminOverview
                ? `${adminOverview.users} users • ${adminOverview.chats} chats • ${adminOverview.media_uploads} uploads`
                : 'Admin overview unavailable'}
            </span>
            <span>
              {adminOverview
                ? `${adminOverview.federation_peers} federation peers • ${adminOverview.pending_federation_peers} pending • ${adminOverview.queued_federation_deliveries ?? 0} queued deliveries`
                : 'Federation stats unavailable'}
            </span>
          </div>
          <form className="new-chat-form" onSubmit={handleCreateFederationPeer}>
            <label className="auth-field">
              <span>Peer domain</span>
              <input
                disabled={loading}
                onChange={(event) => setFederationDomain(event.target.value)}
                placeholder="chat.remote.example"
                value={federationDomain}
              />
            </label>
            <label className="auth-field">
              <span>Display name</span>
              <input
                disabled={loading}
                onChange={(event) => setFederationDisplayName(event.target.value)}
                placeholder="Remote Example"
                value={federationDisplayName}
              />
            </label>
            <button className="secondary-action" disabled={loading || federationDomain.trim() === ''} type="submit">
              Add Federation Peer
            </button>
          </form>
          <div className="settings-card__list">
            {federationPeers.length === 0 ? (
              <span className="settings-card__muted">No federation peers configured yet.</span>
            ) : (
              federationPeers.slice(0, 3).map((peer) => (
                <div className="settings-card__row" key={peer.id}>
                  <div className="settings-card__row-main">
                    <strong>{peer.display_name || peer.domain}</strong>
                    <span>
                      {peer.status}
                      {peer.last_seen_at ? ` • seen ${formatRelativeTime(peer.last_seen_at)}` : ''}
                    </span>
                  </div>
                  <div className="settings-card__row-actions">
                    <button
                      className="mini-action"
                      disabled={loading}
                      onClick={() =>
                        handleUpdateFederationPeerStatus(
                          peer.id,
                          peer.status === 'active' ? 'disabled' : 'active'
                        )
                      }
                      type="button"
                    >
                      {peer.status === 'active' ? 'Disable' : 'Activate'}
                    </button>
                    <button
                      className="mini-action"
                      disabled={loading}
                      onClick={() => handleHeartbeatFederationPeer(peer.id)}
                      type="button"
                    >
                      Ping
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </GlassSurface>
        <GlassSurface className="settings-card">
          <div className="settings-card__header">
            <span className="sidebar__eyebrow">Stage 7</span>
            <h3>Call bootstrap</h3>
          </div>
          <div className="device-summary-card">
            <strong>{activeCall ? `${activeCall.mode} call active` : turnCredentials ? 'TURN credentials ready' : 'TURN credentials unavailable'}</strong>
            <span>{turnCredentials ? `Expires ${formatRelativeTime(turnCredentials.expires_at)}` : 'Refresh to fetch a short-lived credential set.'}</span>
            <span>
              {activeCall
                ? `Started ${formatRelativeTime(activeCall.started_at)}`
                : turnCredentials
                  ? `${turnCredentials.uris.length} relay URI${turnCredentials.uris.length === 1 ? '' : 's'} issued`
                  : 'No active TURN lease'}
            </span>
            <span>
              {activeCall
                ? callRoom
                  ? `${callRoom.participant_count} participant${callRoom.participant_count === 1 ? '' : 's'} in ${callRoom.backend}`
                  : 'Membrane room is active and ready for join state'
                : 'A Membrane room spins up when a call becomes active'}
            </span>
            <span>
              {activeCall
                ? callWebRtcEndpoint
                  ? callWebRtcEndpoint.exists
                    ? `Membrane endpoint ${callWebRtcEndpoint.endpoint_id} ready • ${callWebRtcEndpoint.pending_media_event_count} queued event${callWebRtcEndpoint.pending_media_event_count === 1 ? '' : 's'}`
                    : 'Membrane WebRTC endpoint not provisioned for this device yet'
                  : 'Membrane WebRTC endpoint state not loaded yet'
                : 'Endpoint state appears after a call becomes active'}
            </span>
            <span>
              {webRtcReady
                ? membraneClientConnected
                  ? `Fallback browser lab ready (${webRtcConnectionState} • ${webRtcSignalingState})`
                  : `WebRTC ${webRtcConnectionState} • ${webRtcSignalingState}`
                : 'Browser WebRTC lab not initialized yet'}
            </span>
            <span>
              {membraneClientReady
                ? membraneClientConnected
                  ? `Membrane client connected as ${membraneClientEndpointId ?? 'pending'} • ${membraneRemoteEndpointCount} remote endpoint${membraneRemoteEndpointCount === 1 ? '' : 's'} • ${membraneRemoteTrackCount} remote track${membraneRemoteTrackCount === 1 ? '' : 's'}`
                  : 'Membrane client initialized and waiting for native endpoint events'
                : 'Membrane browser client not initialized yet'}
            </span>
            <span>
              {membraneClientConnected
                ? `${membraneReadyTrackCount} ready native track${membraneReadyTrackCount === 1 ? '' : 's'} • ${membraneReadyAudioTrackCount} audio • ${membraneReadyVideoTrackCount} video`
                : 'Native remote track readiness appears after endpoint negotiation completes'}
            </span>
            <span>
              {membraneRemoteEndpointIds.length > 0
                ? `Remote endpoint IDs: ${membraneRemoteEndpointIds.join(', ')}`
                : 'No remote Membrane endpoints announced yet'}
            </span>
            <span>
              {membraneRemoteTrackIds.length > 0
                ? `Remote track IDs: ${membraneRemoteTrackIds.join(', ')}`
                : 'No remote Membrane tracks announced yet'}
            </span>
            <span>
              {localMediaMode === 'none'
                ? 'No local camera/microphone tracks attached'
                : `${localAudioTrackCount} local audio • ${localVideoTrackCount} local video`}
            </span>
            <span>
              {`${remoteAudioTrackCount} remote audio • ${remoteVideoTrackCount} remote video`}
            </span>
          </div>
          <div className="settings-card__actions">
            <button className="secondary-action" disabled={loading} onClick={handleRefreshTurnCredentials} type="button">
              Refresh TURN Credentials
            </button>
            <button
              className="secondary-action"
              disabled={loading || !activeCall}
              onClick={handleProvisionMembraneWebRtcEndpoint}
              type="button"
            >
              Provision Membrane Endpoint
            </button>
            <button
              className="secondary-action"
              disabled={loading || !activeCall}
              onClick={handleInitializeWebRtc}
              type="button"
            >
              Initialize WebRTC + Membrane
            </button>
            <button
              className="secondary-action"
              disabled={loading || !activeCall}
              onClick={() => handleAttachLocalMedia('audio')}
              type="button"
            >
              Attach Microphone
            </button>
            <button
              className="secondary-action"
              disabled={loading || !activeCall}
              onClick={() => handleAttachLocalMedia('audio_video')}
              type="button"
            >
              Attach Camera + Mic
            </button>
            <button
              className="secondary-action"
              disabled={loading || !activeChat}
              onClick={() => handleStartCall('voice')}
              type="button"
            >
              Start Voice Call
            </button>
            <button
              className="secondary-action"
              disabled={loading || !activeChat}
              onClick={() => handleStartCall('video')}
              type="button"
            >
              Start Video Call
            </button>
            <button
              className="secondary-action"
              disabled={loading || !activeCall}
              onClick={handleCreateWebRtcOffer}
              type="button"
            >
              Create Fallback Offer
            </button>
            <button
              className="secondary-action"
              disabled={loading || !activeCall}
              onClick={handlePingMembraneWebRtcEndpoint}
              type="button"
            >
              Ping Membrane Endpoint
            </button>
            <button
              className="secondary-action"
              disabled={loading || !activeCall}
              onClick={handlePollMembraneWebRtcEndpoint}
              type="button"
            >
              Poll Membrane Events
            </button>
            <button
              className="secondary-action"
              disabled={loading || !activeCall}
              onClick={handleJoinActiveCall}
              type="button"
            >
              Join Membrane Room
            </button>
            <button
              className="secondary-action"
              disabled={loading || !activeCall}
              onClick={handleLeaveActiveCall}
              type="button"
            >
              Leave Room
            </button>
            <button
              className="secondary-action"
              disabled={loading || (!activeCall && localMediaMode === 'none')}
              onClick={handleReleaseLocalMedia}
              type="button"
            >
              Release Local Media
            </button>
            <button
              className="danger-action"
              disabled={loading || !activeCall}
              onClick={handleEndCall}
              type="button"
            >
              End Active Call
            </button>
          </div>
          <form className="new-chat-form" onSubmit={handleSendCallSignal}>
            <label className="auth-field">
              <span>Signal type</span>
              <select
                disabled={loading || !activeCall || membraneClientConnected}
                onChange={(event) => setCallSignalType(event.target.value as CallSignal['signal_type'])}
                value={callSignalType}
              >
                <option value="offer">offer</option>
                <option value="answer">answer</option>
                <option value="ice">ice</option>
                <option value="renegotiate">renegotiate</option>
                <option value="heartbeat">heartbeat</option>
              </select>
            </label>
            <label className="auth-field">
              <span>Signal target</span>
              <select
                disabled={loading || !activeCall || membraneClientConnected}
                onChange={(event) => setCallSignalTargetDeviceId(event.target.value)}
                value={callSignalTargetDeviceId}
              >
                <option value={CALL_SIGNAL_BROADCAST}>Broadcast to joined peers</option>
                {callParticipants
                  .filter(
                    (participant) =>
                      participant.status === 'joined' &&
                      participant.device_id !== storedDevice?.deviceId
                  )
                  .map((participant) => (
                    <option key={participant.device_id} value={participant.device_id}>
                      {participant.device_id}
                    </option>
                  ))}
              </select>
            </label>
            <label className="auth-field">
              <span>
                {membraneClientConnected
                  ? 'Fallback signal payload (disabled while native Membrane is active)'
                  : 'Signal payload'}
              </span>
              <textarea
                disabled={loading || !activeCall || membraneClientConnected}
                onChange={(event) => setCallSignalPayload(event.target.value)}
                placeholder='{"type":"offer","sdp":"stub-offer"}'
                rows={3}
                value={callSignalPayload}
              />
            </label>
            <button
              className="secondary-action"
              disabled={
                loading || !activeCall || membraneClientConnected || callSignalPayload.trim() === ''
              }
              type="submit"
            >
              Send Signal
            </button>
          </form>
          <div className="settings-card__list">
            {callParticipants.length > 0 ? (
              callParticipants.map((participant) => (
                <div className="settings-card__row" key={participant.id}>
                  <div className="settings-card__row-main">
                    <strong>{participant.device_id === storedDevice?.deviceId ? 'This device' : participant.device_id}</strong>
                    <span>
                      {participant.status} • {participant.track_kind}
                    </span>
                  </div>
                  <span className="call-room-pill">{participant.left_at ? 'Left' : 'Live'}</span>
                </div>
              ))
            ) : turnCredentials?.uris.length ? (
              turnCredentials.uris.map((uri) => (
                <div className="settings-card__row" key={uri}>
                  <div className="settings-card__row-main">
                    <strong>Relay</strong>
                    <span>{uri}</span>
                  </div>
                </div>
              ))
            ) : (
              <span className="settings-card__muted">No relay URIs loaded.</span>
            )}
          </div>
          <div className="settings-card__list">
            {callSignals.length > 0 ? (
              callSignals
                .slice(-4)
                .reverse()
                .map((signal) => (
                  <div className="settings-card__row" key={signal.id}>
                    <div className="settings-card__row-main">
                      <strong>{signal.signal_type}</strong>
                      <span>
                        {signal.from_device_id === storedDevice?.deviceId ? 'This device' : signal.from_device_id}
                        {' • '}
                        {formatRelativeTime(signal.inserted_at)}
                      </span>
                      <span>{truncateSignalPayload(signal.payload)}</span>
                    </div>
                  </div>
                ))
            ) : (
              <span className="settings-card__muted">No call signals recorded yet.</span>
            )}
          </div>
          <div className="settings-card__list">
            {featuredRemoteTrack ? (
              <div className="settings-card__row">
                <div className="settings-card__row-main">
                  <strong>
                    {dominantRemoteEndpoint
                      ? `Featured remote: ${dominantRemoteEndpoint.username ?? dominantRemoteEndpoint.deviceId ?? dominantRemoteEndpoint.id}`
                      : 'Featured remote track'}
                  </strong>
                  <span>
                    {featuredRemoteTrack.kind ? `${featuredRemoteTrack.kind} track` : 'Unknown track'}
                    {' • '}
                    {featuredRemoteTrack.endpointId}
                    {featuredRemoteTrack.source ? ` • ${featuredRemoteTrack.source}` : ''}
                  </span>
                  <RemoteMembraneTrackPreview featured track={featuredRemoteTrack} />
                </div>
                <span className="call-room-pill">
                  {dominantRemoteEndpointId ? 'Dominant' : 'Live'}
                </span>
              </div>
            ) : null}
            {membraneRemoteEndpoints.length > 0 ? (
              membraneRemoteEndpoints.slice(0, 4).map((endpoint) => (
                <div className="settings-card__row" key={`remote-endpoint-${endpoint.id}`}>
                  <div className="settings-card__row-main">
                    <strong>
                      {endpoint.username
                        ? `${endpoint.username} (${endpoint.deviceId ?? endpoint.id})`
                        : endpoint.deviceId ?? endpoint.id}
                    </strong>
                    <span>
                      {endpoint.type} • {endpoint.trackIds.length} announced track
                      {endpoint.trackIds.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <span className="call-room-pill">
                    {endpoint.id === dominantRemoteEndpointId ? 'Dominant' : 'Remote'}
                  </span>
                </div>
              ))
            ) : null}
            {membraneRemoteTracks.length > 0 ? (
              membraneRemoteTracks.slice(0, 6).map((track) => (
                <div className="settings-card__row" key={`remote-track-${track.id}`}>
                  <div className="settings-card__row-main">
                    <strong>{track.kind ? `${track.kind} track` : 'Unknown track'}</strong>
                    <span>
                      {track.endpointId}
                      {track.source ? ` • ${track.source}` : ''}
                    </span>
                    {track.voiceActivity ? (
                      <span>Voice activity: {track.voiceActivity}</span>
                    ) : null}
                    <span>{track.id}</span>
                    <RemoteMembraneTrackPreview track={track} />
                  </div>
                  <span className="call-room-pill">
                    {track.ready ? (track.voiceActivity === 'speech' ? 'Speaking' : 'Ready') : 'Negotiating'}
                  </span>
                </div>
              ))
            ) : null}
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>Membrane endpoint</strong>
                <span>
                  {callWebRtcEndpoint
                    ? `${callWebRtcEndpoint.endpoint_id} • ${callWebRtcEndpoint.exists ? 'provisioned' : 'missing'}`
                    : 'No per-device Membrane endpoint loaded'}
                </span>
                <span>
                  {callRoom
                    ? `${callRoom.endpoint_count ?? 0} engine endpoints • ${callRoom.webrtc_endpoint_count ?? 0} WebRTC endpoint${(callRoom.webrtc_endpoint_count ?? 0) === 1 ? '' : 's'}`
                    : 'Room metrics unavailable'}
                </span>
              </div>
            </div>
            {callWebRtcMediaEvents.length > 0 ? (
              callWebRtcMediaEvents.map((eventPayload, index) => (
                <div className="settings-card__row" key={`${index}-${eventPayload}`}>
                  <div className="settings-card__row-main">
                    <strong>Membrane event</strong>
                    <span>{truncateSignalPayload(eventPayload)}</span>
                  </div>
                </div>
              ))
            ) : (
              <span className="settings-card__muted">No outbound Membrane endpoint events polled yet.</span>
            )}
          </div>
          <div className="settings-card__list">
            <div className="settings-card__row">
              <div className="settings-card__row-main">
                <strong>WebRTC lab</strong>
                <span>
                  {webRtcReady ? `${webRtcConnectionState} • ${webRtcSignalingState}` : 'Not initialized'}
                </span>
                <span>
                  {webRtcIceOutboundCount} outbound ICE • {webRtcIceInboundCount} inbound ICE
                </span>
                <span>
                  {localMediaMode === 'none'
                    ? 'No local tracks'
                    : `${localAudioTrackCount} local audio • ${localVideoTrackCount} local video`}
                </span>
                <span>
                  {`${remoteAudioTrackCount} remote audio • ${remoteVideoTrackCount} remote video`}
                </span>
              </div>
            </div>
            {webRtcLocalDescription ? (
              <div className="settings-card__row">
                <div className="settings-card__row-main">
                  <strong>Local SDP</strong>
                  <span>{truncateSignalPayload(webRtcLocalDescription)}</span>
                </div>
              </div>
            ) : null}
            {webRtcRemoteDescription ? (
              <div className="settings-card__row">
                <div className="settings-card__row-main">
                  <strong>Remote SDP</strong>
                  <span>{truncateSignalPayload(webRtcRemoteDescription)}</span>
                </div>
              </div>
            ) : null}
          </div>
        </GlassSurface>
        <CallSurface
          mode={activeCall ? 'active' : 'minimized'}
          flavor={
            activeCall?.mode === 'video'
              ? 'video'
              : activeCall?.mode === 'group'
                ? 'group'
                : 'voice'
          }
        />
      </aside>
    </div>
  )
}

function RemoteMembraneTrackPreview({
  track,
  featured = false
}: {
  track: MembraneRemoteTrackSnapshot
  featured?: boolean
}) {
  const mediaElementRef = useRef<HTMLMediaElement | null>(null)

  useEffect(() => {
    const mediaElement = mediaElementRef.current

    if (!mediaElement) {
      return
    }

    if (!track.ready || !track.mediaTrack || !track.kind) {
      mediaElement.srcObject = null
      return
    }

    const previewStream = new MediaStream([track.mediaTrack])
    mediaElement.srcObject = previewStream

    return () => {
      if (mediaElementRef.current === mediaElement) {
        mediaElement.srcObject = null
      }
    }
  }, [track.id, track.kind, track.mediaTrack, track.ready])

  if (!track.ready || !track.mediaTrack || !track.kind) {
    return null
  }

  return (
    <div className={featured ? 'call-preview call-preview--featured' : 'call-preview'}>
      {track.kind === 'audio' ? (
        <audio
          autoPlay
          controls
          playsInline
          ref={(element) => {
            mediaElementRef.current = element
          }}
        />
      ) : (
        <video
          autoPlay
          muted
          playsInline
          ref={(element) => {
            mediaElementRef.current = element
          }}
        />
      )}
    </div>
  )
}

export default App

async function projectMessage(
  message: ChatMessage,
  currentDeviceId: string,
  encryptionPrivateKeyPkcs8Base64?: string
): Promise<CachedMessage> {
  if (message.message_kind === 'system') {
    return {
      id: message.id,
      clientId: message.client_id,
      text: decodeSystemMessageText(message.ciphertext),
      sentAt: message.inserted_at,
      side: 'system',
      decryptable: true,
      reactions: message.reactions.map((reaction) => ({
        reactionKey: reaction.reaction_key,
        count: reaction.count,
        reacted: reaction.reacted
      }))
    }
  }

  try {
    const decryptedText = await decryptMessageText(
      message,
      currentDeviceId,
      encryptionPrivateKeyPkcs8Base64
    )
    const parsedPayload = parseDecryptedPayload(decryptedText)

    return {
      id: message.id,
      clientId: message.client_id,
      replyToMessageId: message.reply_to_message_id ?? undefined,
      text: parsedPayload.text,
      sentAt: message.inserted_at,
      side: message.sender_device_id === currentDeviceId ? 'outgoing' : 'incoming',
      decryptable: true,
      attachment: parsedPayload.attachment,
      reactions: message.reactions.map((reaction) => ({
        reactionKey: reaction.reaction_key,
        count: reaction.count,
        reacted: reaction.reacted
      }))
    }
  } catch {
    return {
      id: message.id,
      clientId: message.client_id,
      text: '[Encrypted envelope available but not decryptable on this device]',
      sentAt: message.inserted_at,
      side: message.sender_device_id === currentDeviceId ? 'outgoing' : 'incoming',
      decryptable: false,
      reactions: message.reactions.map((reaction) => ({
        reactionKey: reaction.reaction_key,
        count: reaction.count,
        reacted: reaction.reacted
      }))
    }
  }
}

function readDesktopAlwaysOnTopPreference(): boolean | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(DESKTOP_ALWAYS_ON_TOP_STORAGE_KEY)

  if (raw === 'true') {
    return true
  }

  if (raw === 'false') {
    return false
  }

  return null
}

function mergeChat(current: ChatSummary[], next: ChatSummary): ChatSummary[] {
  const filtered = current.filter((chat) => chat.id !== next.id)
  return [next, ...filtered]
}

function toLocalSessionDeviceMaterial(storedDevice: StoredDevice): LocalSessionDeviceMaterial {
  return {
    deviceId: storedDevice.deviceId,
    encryptionPrivateKeyPkcs8Base64: storedDevice.encryptionPrivateKeyPkcs8Base64,
    signedPrekeyPublicKeyBase64: storedDevice.signedPrekeyPublicKeyBase64,
    signedPrekeyPrivateKeyPkcs8Base64: storedDevice.signedPrekeyPrivateKeyPkcs8Base64,
    signedPrekeys:
      storedDevice.signedPrekeys ??
      (storedDevice.signedPrekeyPublicKeyBase64 && storedDevice.signedPrekeyPrivateKeyPkcs8Base64
        ? [
            {
              publicKeyBase64: storedDevice.signedPrekeyPublicKeyBase64,
              privateKeyPkcs8Base64: storedDevice.signedPrekeyPrivateKeyPkcs8Base64
            }
          ]
        : []),
    oneTimePrekeys: storedDevice.oneTimePrekeys
  }
}

function canUseChatSessions(
  storedDevice: StoredDevice,
  sessions: ChatDeviceSession[],
  recipientDevices: RecipientDevice[]
): boolean {
  if (!storedDevice.encryptionPrivateKeyPkcs8Base64) {
    return false
  }

  const outboundRecipientIds = new Set(
    sessions
      .filter((session) => session.initiator_device_id === storedDevice.deviceId)
      .map((session) => session.recipient_device_id)
  )

  return recipientDevices.every((device) => outboundRecipientIds.has(device.device_id))
}

function shouldUseRecipientWrapping(
  storedDevice: StoredDevice,
  recipientDevices: RecipientDevice[]
): boolean {
  if (!storedDevice.encryptionPrivateKeyPkcs8Base64 || !storedDevice.encryptionPublicKeyBase64) {
    return false
  }

  if (recipientDevices.length === 0) {
    return false
  }

  return recipientDevices.some((device) => device.device_id === storedDevice.deviceId)
}

function mergeMessageThread(current: CachedMessage[], next: CachedMessage): CachedMessage[] {
  const filtered = current.filter((message) => {
    if (message.id === next.id) {
      return false
    }

    if (next.clientId && message.clientId === next.clientId) {
      return false
    }

    return true
  })

  return [...filtered, next].sort(compareMessageOrder)
}

function syncChatSummary(current: ChatSummary[], chatId: string, messages: CachedMessage[]): ChatSummary[] {
  const chat = current.find((entry) => entry.id === chatId)

  if (!chat) {
    return current
  }

  const latestMessageAt = messages.at(-1)?.sentAt ?? chat.latest_message_at

  return mergeChat(current, {
    ...chat,
    latest_message_at: latestMessageAt,
    message_count: messages.length
  })
}

function compareMessageOrder(left: CachedMessage, right: CachedMessage): number {
  const leftTime = Date.parse(left.sentAt)
  const rightTime = Date.parse(right.sentAt)

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return left.sentAt.localeCompare(right.sentAt)
  }

  return leftTime - rightTime
}

function parseDecryptedPayload(plaintext: string): {
  text: string
  attachment?: CachedMessage['attachment']
} {
  try {
    const parsed = JSON.parse(plaintext) as Partial<AttachmentDescriptor>

    if (
      parsed.kind === 'attachment' &&
      typeof parsed.uploadId === 'string' &&
      typeof parsed.fileName === 'string' &&
      typeof parsed.contentType === 'string' &&
      typeof parsed.size === 'number' &&
      Number.isFinite(parsed.size) &&
      (typeof parsed.thumbnailDataUrl === 'undefined' || typeof parsed.thumbnailDataUrl === 'string') &&
      typeof parsed.contentKeyBase64 === 'string' &&
      typeof parsed.ivBase64 === 'string'
    ) {
      return {
        text: `Attachment: ${parsed.fileName}`,
        attachment: {
          uploadId: parsed.uploadId,
          fileName: parsed.fileName,
          contentType: parsed.contentType,
          size: parsed.size,
          thumbnailDataUrl: parsed.thumbnailDataUrl,
          contentKeyBase64: parsed.contentKeyBase64,
          ivBase64: parsed.ivBase64
        }
      }
    }
  } catch {
    // Plain text payloads are expected.
  }

  return {
    text: plaintext
  }
}

function toAttachmentDescriptor(attachment: NonNullable<CachedMessage['attachment']>): AttachmentDescriptor {
  if (!attachment.contentKeyBase64 || !attachment.ivBase64) {
    throw new Error('The attachment is missing local decryption material.')
  }

  return {
    kind: 'attachment',
    uploadId: attachment.uploadId,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    size: attachment.size,
    thumbnailDataUrl: attachment.thumbnailDataUrl,
    contentKeyBase64: attachment.contentKeyBase64,
    ivBase64: attachment.ivBase64
  }
}

function inferMediaKind(contentType: string): 'file' | 'image' | 'audio' | 'video' {
  if (contentType.startsWith('image/')) {
    return 'image'
  }

  if (contentType.startsWith('audio/')) {
    return 'audio'
  }

  if (contentType.startsWith('video/')) {
    return 'video'
  }

  return 'file'
}

function resolveReplyPreview(messages: CachedMessage[], replyToMessageId: string): string {
  const target = messages.find((message) => message.id === replyToMessageId)

  if (!target) {
    return 'an earlier message'
  }

  const preview = target.text.trim()

  if (preview.length === 0) {
    return 'an earlier message'
  }

  return preview.length > 64 ? `${preview.slice(0, 61)}...` : preview
}

function formatRelativeTime(value: string | null): string {
  if (!value) {
    return 'Now'
  }

  const timestamp = new Date(value)

  if (Number.isNaN(timestamp.getTime())) {
    return 'Now'
  }

  return timestamp.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function mergeCallSignals(current: CallSignal[], nextSignal: CallSignal): CallSignal[] {
  return [...current.filter((signal) => signal.id !== nextSignal.id), nextSignal]
    .sort((left, right) => left.inserted_at.localeCompare(right.inserted_at))
    .slice(-12)
}

function parseMembraneBridgeSignal(eventPayload: string): CallSignal | null {
  try {
    const parsed = JSON.parse(eventPayload) as {
      kind?: unknown
      signal?: Record<string, unknown>
    }

    if (parsed.kind !== 'call_signal_bridge' || !parsed.signal || typeof parsed.signal !== 'object') {
      return null
    }

    const signal = parsed.signal

    if (
      typeof signal.id !== 'string' ||
      typeof signal.call_id !== 'string' ||
      typeof signal.from_device_id !== 'string' ||
      typeof signal.signal_type !== 'string' ||
      typeof signal.payload !== 'string' ||
      typeof signal.inserted_at !== 'string'
    ) {
      return null
    }

    if (
      signal.signal_type !== 'offer' &&
      signal.signal_type !== 'answer' &&
      signal.signal_type !== 'ice' &&
      signal.signal_type !== 'renegotiate' &&
      signal.signal_type !== 'heartbeat'
    ) {
      return null
    }

    return {
      id: signal.id,
      call_id: signal.call_id,
      from_device_id: signal.from_device_id,
      target_device_id: typeof signal.target_device_id === 'string' ? signal.target_device_id : null,
      signal_type: signal.signal_type,
      payload: signal.payload,
      inserted_at: signal.inserted_at
    }
  } catch {
    return null
  }
}

function readMembraneNativeEventType(eventPayload: string): string | null {
  try {
    const parsed = JSON.parse(eventPayload) as {
      kind?: unknown
      type?: unknown
    }

    if (parsed.kind === 'call_signal_bridge') {
      return null
    }

    return typeof parsed.type === 'string' ? parsed.type : null
  } catch {
    return null
  }
}

function decodeSystemMessageText(payloadBase64: string): string {
  try {
    return new TextDecoder().decode(base64ToBytes(payloadBase64))
  } catch {
    return '[System event unavailable]'
  }
}

function truncateSignalPayload(payload: string): string {
  return payload.length > 88 ? `${payload.slice(0, 85)}...` : payload
}

function buildDesktopWindowTitle(
  activeChatTitle: string | null,
  activeCallMode: 'voice' | 'video' | 'group' | null
): string {
  const parts = ['Vostok']

  if (activeChatTitle) {
    parts.push(activeChatTitle)
  }

  if (activeCallMode) {
    const label =
      activeCallMode === 'group'
        ? 'Group Call'
        : activeCallMode === 'video'
          ? 'Video Call'
          : 'Voice Call'

    parts.push(label)
  }

  return parts.join(' • ')
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const tagName = target.tagName

  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

function pickDominantRemoteSpeakerEndpointId(
  tracks: MembraneRemoteTrackSnapshot[]
): string | null {
  const speakingAudioTrack = tracks.find(
    (track) => track.ready && track.kind === 'audio' && track.voiceActivity === 'speech'
  )

  if (speakingAudioTrack) {
    return speakingAudioTrack.endpointId
  }

  const speakingTrack = tracks.find((track) => track.ready && track.voiceActivity === 'speech')

  if (speakingTrack) {
    return speakingTrack.endpointId
  }

  return null
}

function pickFeaturedRemoteTrack(
  tracks: MembraneRemoteTrackSnapshot[],
  dominantEndpointId: string | null
): MembraneRemoteTrackSnapshot | null {
  if (dominantEndpointId) {
    const dominantVideoTrack = tracks.find(
      (track) => track.ready && track.kind === 'video' && track.endpointId === dominantEndpointId
    )

    if (dominantVideoTrack) {
      return dominantVideoTrack
    }

    const dominantTrack = tracks.find(
      (track) => track.ready && track.endpointId === dominantEndpointId
    )

    if (dominantTrack) {
      return dominantTrack
    }
  }

  const firstReadyVideoTrack = tracks.find((track) => track.ready && track.kind === 'video')

  if (firstReadyVideoTrack) {
    return firstReadyVideoTrack
  }

  return tracks.find((track) => track.ready) ?? null
}
