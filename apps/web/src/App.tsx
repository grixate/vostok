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
import { outboxRetryDelayMs, sha256Hex } from '@vostok/crypto-core'
import {
  ChatInfoPanel,
  ChatListItem,
  ConversationHeader,
  MessageBubble
} from '@vostok/ui-chat'
import {
  appendMediaUploadPart,
  attemptFederationDelivery,
  createCallSession,
  createFederationDelivery,
  createFederationPeer,
  createFederationPeerInvite,
  recordFederationPeerHeartbeat,
  bootstrapChatSessions,
  completeMediaUpload,
  createDirectChat,
  distributeGroupSenderKeys,
  createGroupChat,
  fetchMediaLinkMetadata,
  fetchMediaUploadState,
  createMediaUpload,
  createMessage,
  deleteMessage,
  endCallSession,
  fetchCallWebRtcEndpointState,
  fetchCallState,
  toggleMessageReaction,
  updateMessage,
  fetchAdminOverview,
  fetchActiveCall,
  fetchCallKeys,
  listDevices,
  listFederationDeliveries,
  listGroupMembers,
  listGroupSenderKeys,
  listSafetyNumbers,
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
  rekeyChatSessions,
  renameGroupChat,
  registerDevice,
  revokeDevice,
  removeGroupMember,
  toggleMessagePin,
  updateGroupMemberRole,
  updateFederationPeerStatus,
  rotateCallKeys,
  verifyChallenge,
  verifySafetyNumber,
  type AdminOverview,
  type CallParticipant,
  type CallKeyDistribution,
  type CallRoomState,
  type CallSignal,
  type CallSession,
  type CallWebRtcEndpointState,
  type ChatDeviceSession,
  type ChatMessage,
  type ChatSummary,
  type DeviceInfo,
  type FederationDeliveryJob,
  type FederationPeer,
  type GroupSenderKey,
  type GroupMember,
  type LinkMetadata,
  type RecipientDevice,
  type PrekeyDeviceBundle,
  type SafetyNumberRecord,
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
  pruneConsumedOneTimePrekeys,
  synchronizeChatSessions,
  type LocalSessionDeviceMaterial
} from './lib/chat-session-vault'
import { readCachedMessages, writeCachedMessages, type CachedMessage } from './lib/message-cache'
import {
  countOutboxMessages,
  deleteOutboxMessage,
  listDueOutboxMessages,
  markOutboxRetry,
  queueOutboxMessage
} from './lib/outbox-queue'
import {
  decryptMessageText,
  encryptMessageWithGroupSenderKey,
  getActiveGroupSenderKey,
  setActiveGroupSenderKey,
  storeGroupSenderKeyMaterial,
  storeInboundGroupSenderKeys,
  wrapGroupSenderKeyForRecipients
} from './lib/message-vault'
import { subscribeToCallStream, subscribeToChatStream } from './lib/realtime'
import {
  decryptAttachmentFile,
  encryptAttachmentFile,
  generateAttachmentThumbnailDataUrl,
  generateAttachmentWaveform
} from './lib/attachment-vault'
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
import { base64ToBytes, bytesToBase64 } from './lib/base64'

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

type SafetyNumberEntry = {
  peerDeviceId: string
  peerUsername: string
  peerDeviceName: string
  label: string
  fingerprint: string
  verified: boolean
  verifiedAt: string | null
}

type AttachmentDescriptor = {
  kind: 'attachment'
  uploadId: string
  fileName: string
  contentType: string
  size: number
  thumbnailDataUrl?: string
  waveform?: number[]
  contentKeyBase64: string
  ivBase64: string
}

const STORAGE_KEY = 'vostok.device'
const DETAIL_RAIL_STORAGE_KEY = 'vostok.layout.detail_rail_visible'
const DESKTOP_ALWAYS_ON_TOP_STORAGE_KEY = 'vostok.desktop.always_on_top'
const DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY = 'vostok.desktop.window_geometry'
const DESKTOP_DETAIL_RAIL_BREAKPOINT = 1200

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
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [replyTargetMessageId, setReplyTargetMessageId] = useState<string | null>(null)
  const [voiceNoteRecording, setVoiceNoteRecording] = useState(false)
  const [roundVideoRecording, setRoundVideoRecording] = useState(false)
  const [newChatUsername, setNewChatUsername] = useState('')
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [newGroupMembers, setNewGroupMembers] = useState('')
  const [groupRenameTitle, setGroupRenameTitle] = useState('')
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [_devices, setDevices] = useState<DeviceInfo[]>([])
  const [_groupSenderKeys, setGroupSenderKeys] = useState<GroupSenderKey[]>([])
  const [_outboxPendingCount, setOutboxPendingCount] = useState(0)
  const [linkMetadataByUrl, setLinkMetadataByUrl] = useState<Record<string, LinkMetadata>>({})
  const [safetyNumbers, setSafetyNumbers] = useState<SafetyNumberEntry[]>([])
  const [verifyingSafetyDeviceId, setVerifyingSafetyDeviceId] = useState<string | null>(null)
  const [_remotePrekeyBundles, setRemotePrekeyBundles] = useState<PrekeyDeviceBundle[]>([])
  const [chatSessions, setChatSessions] = useState<ChatDeviceSession[]>([])
  const [_adminOverview, setAdminOverview] = useState<AdminOverview | null>(null)
  const [_federationPeers, setFederationPeers] = useState<FederationPeer[]>([])
  const [_federationDeliveries, setFederationDeliveries] = useState<FederationDeliveryJob[]>([])
  const [federationDomain, setFederationDomain] = useState('')
  const [federationDisplayName, setFederationDisplayName] = useState('')
  const [_federationInviteToken, setFederationInviteToken] = useState<string | null>(null)
  const [_turnCredentials, setTurnCredentials] = useState<TurnCredentials | null>(null)
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
  const [membraneRemoteEndpoints, setMembraneRemoteEndpoints] = useState<
    MembraneRemoteEndpointSnapshot[]
  >([])
  const [membraneRemoteTracks, setMembraneRemoteTracks] = useState<MembraneRemoteTrackSnapshot[]>(
    []
  )
  const [_membraneClientEndpointId, setMembraneClientEndpointId] = useState<string | null>(null)
  const [attachmentPlaybackUrls, setAttachmentPlaybackUrls] = useState<Record<string, string>>({})

  const deferredActiveChatId = useDeferredValue(activeChatId)
  const activeChatIdRef = useRef<string | null>(deferredActiveChatId)
  const messageItemsRef = useRef<CachedMessage[]>([])
  const voiceNoteRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceNoteStreamRef = useRef<MediaStream | null>(null)
  const voiceNoteChunksRef = useRef<Blob[]>([])
  const roundVideoRecorderRef = useRef<MediaRecorder | null>(null)
  const roundVideoStreamRef = useRef<MediaStream | null>(null)
  const roundVideoChunksRef = useRef<Blob[]>([])
  const linkMetadataInFlightRef = useRef(new Set<string>())
  const attachmentPlaybackUrlsRef = useRef<Record<string, string>>({})
  const attachmentPlaybackInFlightRef = useRef<Map<string, Promise<string>>>(new Map())
  const callSignalsRef = useRef<CallSignal[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const chatButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const chatFilterInputRef = useRef<HTMLInputElement | null>(null)
  const directChatInputRef = useRef<HTMLInputElement | null>(null)
  const groupTitleInputRef = useRef<HTMLInputElement | null>(null)
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null)
  const membraneClientRef = useRef<MembraneClient | null>(null)
  const membraneClientCallIdRef = useRef<string | null>(null)
  const membraneLocalTrackIdsRef = useRef<string[]>([])
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
    const bootstrapTargetDeviceIds = recipientDevices
      .filter((device) => {
        const existingSession = chatSessions.find(
          (session) =>
            session.initiator_device_id === storedDevice.deviceId &&
            session.recipient_device_id === device.device_id &&
            session.session_state !== 'superseded'
        )

        return !existingSession || existingSession.establishment_state !== 'established'
      })
      .map((device) => device.device_id)
    const initiatorEphemeralKeys =
      bootstrapTargetDeviceIds.length > 0
        ? await prepareSessionBootstrap(bootstrapTargetDeviceIds)
        : {}
    const response = await bootstrapChatSessions(storedDevice.sessionToken, chatId, {
      initiator_ephemeral_keys: initiatorEphemeralKeys
    })
    const synchronizedIds = await synchronizeChatSessions(
      toLocalSessionDeviceMaterial(storedDevice),
      response.sessions
    )
    const activeSessions = response.sessions.filter((session) => synchronizedIds.includes(session.id))
    const consumedOneTimePrekeys = pruneConsumedOneTimePrekeys(
      storedDevice.deviceId,
      response.sessions,
      storedDevice.oneTimePrekeys ?? []
    )

    if (consumedOneTimePrekeys.consumedPublicKeys.length > 0) {
      const nextStoredDevice: StoredDevice = {
        ...storedDevice,
        oneTimePrekeys: consumedOneTimePrekeys.nextOneTimePrekeys
      }

      persistStoredDevice(nextStoredDevice)

      if (activeChatIdRef.current === chatId) {
        setStoredDevice(nextStoredDevice)
      }
    }

    if (activeChatIdRef.current === chatId) {
      setChatSessions(activeSessions)
    }

    return activeSessions
  }

  async function _handleRekeyActiveChatSessions() {
    if (!storedDevice || !activeChatId) {
      setBanner({ tone: 'error', message: 'Select a chat before rekeying direct-chat sessions.' })
      return
    }

    setLoading(true)

    try {
      const recipientDevices = (await listRecipientDevices(storedDevice.sessionToken, activeChatId))
        .recipient_devices
      const initiatorEphemeralKeys = await prepareSessionBootstrap(
        recipientDevices.map((device) => device.device_id)
      )
      const response = await rekeyChatSessions(storedDevice.sessionToken, activeChatId, {
        initiator_ephemeral_keys: initiatorEphemeralKeys
      })
      const synchronizedIds = await synchronizeChatSessions(
        toLocalSessionDeviceMaterial(storedDevice),
        response.sessions
      )
      const updatedSessions = response.sessions.filter((session) => synchronizedIds.includes(session.id))
      const consumedOneTimePrekeys = pruneConsumedOneTimePrekeys(
        storedDevice.deviceId,
        response.sessions,
        storedDevice.oneTimePrekeys ?? []
      )
      const mergedSessions = [
        ...chatSessions.filter(
          (existing) =>
            !updatedSessions.some(
              (next) =>
                next.chat_id === existing.chat_id &&
                next.initiator_device_id === existing.initiator_device_id &&
                next.recipient_device_id === existing.recipient_device_id
            )
        ),
        ...updatedSessions
      ]

      if (consumedOneTimePrekeys.consumedPublicKeys.length > 0) {
        const nextStoredDevice: StoredDevice = {
          ...storedDevice,
          oneTimePrekeys: consumedOneTimePrekeys.nextOneTimePrekeys
        }

        persistStoredDevice(nextStoredDevice)

        if (activeChatIdRef.current === activeChatId) {
          setStoredDevice(nextStoredDevice)
        }
      }

      if (activeChatIdRef.current === activeChatId) {
        setChatSessions(mergedSessions)
      }

      setBanner({
        tone: 'success',
        message: `Rekeyed ${updatedSessions.length} direct-chat session ${
          updatedSessions.length === 1 ? 'record' : 'records'
        }.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rekey chat sessions.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function syncMessagesFromServerNow(chatId: string) {
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
  }
  const syncMessagesFromServer = useEffectEvent(async (chatId: string) => {
    await syncMessagesFromServerNow(chatId)
  })
  const handleRealtimeMessage = useEffectEvent((_messageId: string, chatId: string) => {
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
      await refreshDeviceList(nextStoredDevice.sessionToken)
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
      await refreshDeviceList(nextStoredDevice.sessionToken)
      setBanner({ tone: 'success', message: 'Challenge verified. Session refreshed.' })
      startTransition(() => setView('chat'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleRotatePrekeys() {
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
      await refreshDeviceList(nextStoredDevice.sessionToken)
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
    setDevices([])
    setChatSessions([])
    setRemotePrekeyBundles([])
    setSafetyNumbers([])
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
    attachmentPlaybackUrlsRef.current = attachmentPlaybackUrls
  }, [attachmentPlaybackUrls])

  useEffect(
    () => () => {
      voiceNoteRecorderRef.current = null
      voiceNoteChunksRef.current = []

      if (voiceNoteStreamRef.current) {
        for (const track of voiceNoteStreamRef.current.getTracks()) {
          track.stop()
        }
      }

      voiceNoteStreamRef.current = null

      roundVideoRecorderRef.current = null
      roundVideoChunksRef.current = []

      if (roundVideoStreamRef.current) {
        for (const track of roundVideoStreamRef.current.getTracks()) {
          track.stop()
        }
      }

      roundVideoStreamRef.current = null

      for (const playbackUrl of Object.values(attachmentPlaybackUrlsRef.current)) {
        URL.revokeObjectURL(playbackUrl)
      }

      attachmentPlaybackUrlsRef.current = {}
      attachmentPlaybackInFlightRef.current.clear()
    },
    []
  )

  useEffect(() => {
    if (view !== 'chat' || !storedDevice) {
      return
    }

    const { sessionToken } = storedDevice
    let cancelled = false

    async function bootstrapChatShell() {
      setLoading(true)

      try {
        const [me, chatResponse, deviceResponse] = await Promise.all([
          fetchMe(sessionToken),
          listChats(sessionToken),
          listDevices(sessionToken)
        ])
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
        setDevices(deviceResponse.devices)

        if (me.device.prekeys?.replenish_recommended) {
          setBanner({
            tone: 'info',
            message: `One-time prekeys are low (${me.device.prekeys.available_one_time_prekeys}/${me.device.prekeys.target_count}). Rotate prekeys soon.`
          })
        }
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
      setEditingMessageId(null)
      setReplyTargetMessageId(null)
      return
    }

    const chatId = deferredActiveChatId
    let cancelled = false
    setEditingMessageId(null)
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
    linkMetadataInFlightRef.current.clear()
    setLinkMetadataByUrl({})

    for (const playbackUrl of Object.values(attachmentPlaybackUrlsRef.current)) {
      URL.revokeObjectURL(playbackUrl)
    }

    attachmentPlaybackInFlightRef.current.clear()
    attachmentPlaybackUrlsRef.current = {}
    setAttachmentPlaybackUrls({})
  }, [deferredActiveChatId])

  useEffect(() => {
    if (!storedDevice || view !== 'chat') {
      return
    }

    const uniqueUrls = Array.from(
      new Set(
        messageItems
          .map((message) => extractFirstHttpUrl(message.text))
          .filter((url): url is string => Boolean(url))
      )
    )

    if (uniqueUrls.length === 0) {
      return
    }

    const sessionToken = storedDevice.sessionToken

    for (const url of uniqueUrls) {
      if (linkMetadataByUrl[url] || linkMetadataInFlightRef.current.has(url)) {
        continue
      }

      linkMetadataInFlightRef.current.add(url)

      void fetchMediaLinkMetadata(sessionToken, url)
        .then((response) => {
          setLinkMetadataByUrl((current) =>
            current[url] ? current : { ...current, [url]: response.metadata }
          )
        })
        .catch(() => undefined)
        .finally(() => {
          linkMetadataInFlightRef.current.delete(url)
        })
    }
  }, [linkMetadataByUrl, messageItems, storedDevice, view])

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
    if (!storedDevice || !deferredActiveChatId || view !== 'chat') {
      setSafetyNumbers([])
      return
    }

    const sessionToken = storedDevice.sessionToken
    const chatId = deferredActiveChatId
    let cancelled = false

    async function loadSafetyNumbersForChat() {
      try {
        const response = await listSafetyNumbers(sessionToken, chatId)

        if (!cancelled) {
          setSafetyNumbers(response.safety_numbers.map(toSafetyNumberEntry))
        }
      } catch {
        if (!cancelled) {
          setSafetyNumbers([])
        }
      }
    }

    void loadSafetyNumbersForChat()

    return () => {
      cancelled = true
    }
  }, [deferredActiveChatId, storedDevice, view])

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

  async function refreshDeviceList(sessionToken: string) {
    const response = await listDevices(sessionToken)
    setDevices(response.devices)
  }

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

  async function _handleCreateGroupChat(event: FormEvent<HTMLFormElement>) {
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

  async function _handleRenameActiveGroupChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!storedDevice || !activeChat || activeChat.type !== 'group' || groupRenameTitle.trim() === '') {
      return
    }

    setLoading(true)

    try {
      const response = await renameGroupChat(storedDevice.sessionToken, activeChat.id, {
        title: groupRenameTitle.trim()
      })

      setChatItems((current) => mergeChat(current, response.chat))
      setGroupRenameTitle(response.chat.title)
      setBanner({ tone: 'success', message: `Group updated: ${response.chat.title}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename the group.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleUpdateActiveGroupMemberRole(member: GroupMember, role: 'admin' | 'member') {
    if (!storedDevice || !activeChat || activeChat.type !== 'group' || member.role === role) {
      return
    }

    setLoading(true)

    try {
      const response = await updateGroupMemberRole(storedDevice.sessionToken, activeChat.id, member.user_id, role)
      setGroupMembers((current) =>
        current.map((entry) => (entry.user_id === response.member.user_id ? response.member : entry))
      )
      setBanner({
        tone: 'success',
        message: `${response.member.username} is now ${response.member.role}.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update the group member.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleRemoveActiveGroupMember(member: GroupMember) {
    if (!storedDevice || !activeChat || activeChat.type !== 'group') {
      return
    }

    setLoading(true)

    try {
      const response = await removeGroupMember(storedDevice.sessionToken, activeChat.id, member.user_id)
      setGroupMembers((current) => current.filter((entry) => entry.user_id !== response.member.user_id))
      setChatItems((current) =>
        current.map((chat) =>
          chat.id === activeChat.id
            ? {
                ...chat,
                participant_usernames: chat.participant_usernames.filter(
                  (username) => username !== response.member.username
                )
              }
            : chat
        )
      )
      setBanner({ tone: 'success', message: `${response.member.username} was removed from the group.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove the group member.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleRotateGroupSenderKey() {
    if (!storedDevice || !activeChat || activeChat.type !== 'group') {
      return
    }

    setLoading(true)

    try {
      const recipientDevices = (
        await listRecipientDevices(storedDevice.sessionToken, activeChat.id)
      ).recipient_devices.filter((device) => device.device_id !== storedDevice.deviceId)

      if (recipientDevices.length === 0) {
        throw new Error('No recipient devices are currently available for sender key distribution.')
      }

      const senderKeyMaterial = window.crypto.getRandomValues(new Uint8Array(32))
      const senderKeyMaterialBase64 = bytesToBase64(senderKeyMaterial)
      const keyId = `sender-${Date.now()}-${window.crypto.randomUUID()}`
      const wrappedKeys = await wrapGroupSenderKeyForRecipients(
        senderKeyMaterialBase64,
        recipientDevices
      )
      const currentActiveSenderKey = getActiveGroupSenderKey(activeChat.id)
      const nextEpoch = currentActiveSenderKey ? currentActiveSenderKey.epoch + 1 : 1
      const response = await distributeGroupSenderKeys(storedDevice.sessionToken, activeChat.id, {
        key_id: keyId,
        sender_key_epoch: nextEpoch,
        algorithm: 'p256-ecdh+a256gcm',
        wrapped_keys: wrappedKeys
      })

      storeGroupSenderKeyMaterial(activeChat.id, keyId, senderKeyMaterialBase64)
      setActiveGroupSenderKey(activeChat.id, keyId, nextEpoch)
      setGroupSenderKeys(response.sender_keys)
      setBanner({
        tone: 'success',
        message: `Distributed Sender Key ${keyId} (epoch ${nextEpoch}) to ${response.sender_keys.length} recipient device${response.sender_keys.length === 1 ? '' : 's'}.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rotate the group Sender Key.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleRevokeLinkedDevice(deviceId: string) {
    if (!storedDevice) {
      return
    }

    setLoading(true)

    try {
      const response = await revokeDevice(storedDevice.sessionToken, deviceId)
      await refreshDeviceList(storedDevice.sessionToken)
      setBanner({
        tone: 'success',
        message: `Revoked ${response.device.device_name}. Existing sessions for that device are now invalid.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke device.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyPeerSafetyNumber(peerDeviceId: string) {
    if (!storedDevice || !activeChatId) {
      return
    }

    setVerifyingSafetyDeviceId(peerDeviceId)

    try {
      const response = await verifySafetyNumber(storedDevice.sessionToken, activeChatId, peerDeviceId)
      setSafetyNumbers((current) =>
        current.map((entry) =>
          entry.peerDeviceId === response.safety_number.peer_device_id
            ? toSafetyNumberEntry(response.safety_number)
            : entry
        )
      )
      setBanner({
        tone: 'success',
        message: `Verified safety number for ${response.safety_number.peer_device_name}.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to verify safety number.'
      setBanner({ tone: 'error', message })
    } finally {
      setVerifyingSafetyDeviceId(null)
    }
  }

  async function _handleCreateFederationPeer(event: FormEvent<HTMLFormElement>) {
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

  async function _handleQueueFederationDelivery(peerId: string) {
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

  async function _handleCreateFederationPeerInvite(peerId: string) {
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

  async function _handleAttemptFederationDelivery(jobId: string) {
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

  async function _handleUpdateFederationPeerStatus(
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

  async function _handleHeartbeatFederationPeer(peerId: string) {
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

  async function _handleRefreshTurnCredentials() {
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

  async function _handleRefreshDesktopRuntime() {
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

    const targetChat = chatItems.find((chat) => chat.id === chatId) ?? null

    if (targetChat?.type === 'group') {
      const activeSenderKey = getActiveGroupSenderKey(chatId)

      if (!activeSenderKey) {
        throw new Error(
          'No active Sender Key is available for this group chat. Rotate a Sender Key before sending.'
        )
      }

      const payload = {
        client_id: clientId,
        message_kind: messageKind,
        ...(await encryptMessageWithGroupSenderKey(
          plainText,
          chatId,
          activeSenderKey.key_id,
          activeSenderKey.epoch
        ))
      }

      return {
        payload: replyToMessageId ? { ...payload, reply_to_message_id: replyToMessageId } : payload,
        deliveryMode: 'group_sender_key'
      } as const
    }

    const recipientDeviceResponse = await listRecipientDevices(storedDevice.sessionToken, chatId)
    const recipientDevices = recipientDeviceResponse.recipient_devices
    const sessions = await syncChatSessionsFromServer(chatId, recipientDevices)
    const canUseSessionEncryption = canUseChatSessions(storedDevice, sessions, recipientDevices)

    if (!canUseSessionEncryption) {
      throw new Error(
        'Session transport is required for this chat. Rotate prekeys or rekey active sessions and try again.'
      )
    }

    const payload = {
      client_id: clientId,
      message_kind: messageKind,
      ...(await encryptMessageWithSessions(plainText, storedDevice.deviceId, sessions))
    }

    return {
      payload: replyToMessageId ? { ...payload, reply_to_message_id: replyToMessageId } : payload,
      deliveryMode: 'session'
    } as const
  }

  async function queueMessageForOutbox(
    chatId: string,
    payload: {
      client_id: string
      ciphertext: string
      message_kind: string
      header?: string
      crypto_scheme?: string
      sender_key_id?: string
      sender_key_epoch?: number
      reply_to_message_id?: string
      recipient_envelopes?: Record<string, string>
      established_session_ids?: string[]
    },
    lastError: string
  ) {
    await queueOutboxMessage({
      id: payload.client_id,
      chatId,
      payload,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      nextAttemptAt: Date.now(),
      lastError
    })
    setOutboxPendingCount(await countOutboxMessages())
  }

  const replayOutboxMessages = useEffectEvent(async () => {
    if (!storedDevice) {
      setOutboxPendingCount(0)
      return
    }

    const dueMessages = await listDueOutboxMessages(8)

    for (const queued of dueMessages) {
      try {
        const response = await createMessage(storedDevice.sessionToken, queued.chatId, queued.payload)
        await ingestMessageIntoActiveThread(response.message, queued.chatId)
        await deleteOutboxMessage(queued.id)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to replay queued outbound message.'

        if (isOutboxDuplicateClientIdError(message)) {
          await deleteOutboxMessage(queued.id)
          continue
        }

        const nextAttemptCount = queued.attemptCount + 1
        await markOutboxRetry(
          queued.id,
          nextAttemptCount,
          outboxRetryDelayMs(nextAttemptCount),
          message
        )
      }
    }

    setOutboxPendingCount(await countOutboxMessages())
  })

  useEffect(() => {
    let cancelled = false

    async function tickOutbox() {
      if (cancelled) {
        return
      }

      try {
        await replayOutboxMessages()
      } catch {
        // Ignore replay loop errors; next tick will retry.
      }
    }

    void tickOutbox()
    const timer = window.setInterval(() => {
      void tickOutbox()
    }, 8_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [storedDevice?.deviceId, storedDevice?.sessionToken])

  async function sendDraftMessage() {
    if (!storedDevice || !activeChatId || draft.trim() === '') {
      return
    }

    setLoading(true)

    const plainText = draft.trim()
    const activeReplyToMessageId = replyTargetMessageId
    const activeEditingMessageId = editingMessageId

    if (activeEditingMessageId && editingTargetMessage) {
      setDraft('')
      setEditingMessageId(null)
      setReplyTargetMessageId(null)

      try {
        const { payload, deliveryMode } = await buildEncryptedMessagePayload(
          plainText,
          activeChatId,
          editingTargetMessage.clientId ?? `edit-${activeEditingMessageId}`,
          editingTargetMessage.attachment ? 'attachment' : 'text',
          activeReplyToMessageId
        )

        const response = await updateMessage(
          storedDevice.sessionToken,
          activeChatId,
          activeEditingMessageId,
          payload
        )

        await ingestMessageIntoActiveThread(response.message, activeChatId)
        setBanner({
          tone: 'success',
          message:
            deliveryMode === 'group_sender_key'
              ? 'Message edited with Sender Key group encryption.'
              : 'Message edited with session encryption.'
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to edit message.'
        setBanner({ tone: 'error', message })
        setDraft(plainText)
        setEditingMessageId(activeEditingMessageId)
        setReplyTargetMessageId(activeReplyToMessageId)
      } finally {
        setLoading(false)
      }

      return
    }

    const clientId = window.crypto.randomUUID()
    const optimisticId = `optimistic-${clientId}`
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

      try {
        const response = await createMessage(storedDevice.sessionToken, activeChatId, payload)

        await ingestMessageIntoActiveThread(response.message, activeChatId)
        setBanner({
          tone: 'success',
          message:
            deliveryMode === 'group_sender_key'
              ? 'Sender Key encrypted message delivered to the server.'
              : 'Session-bootstrapped encrypted envelope delivered to the server.'
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send message.'

        if (shouldQueueOutboxSendFailure(message)) {
          await queueMessageForOutbox(activeChatId, payload, message)
          setBanner({
            tone: 'info',
            message: 'Message queued for offline replay. It will retry automatically.'
          })
          return
        }

        throw error
      }
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

  function cleanupVoiceNoteCapture() {
    voiceNoteRecorderRef.current = null
    voiceNoteChunksRef.current = []

    if (voiceNoteStreamRef.current) {
      for (const track of voiceNoteStreamRef.current.getTracks()) {
        track.stop()
      }
    }

    voiceNoteStreamRef.current = null
    setVoiceNoteRecording(false)
  }

  function cleanupRoundVideoCapture() {
    roundVideoRecorderRef.current = null
    roundVideoChunksRef.current = []

    if (roundVideoStreamRef.current) {
      for (const track of roundVideoStreamRef.current.getTracks()) {
        track.stop()
      }
    }

    roundVideoStreamRef.current = null
    setRoundVideoRecording(false)
  }

  async function uploadEncryptedAttachmentMultipart(
    sessionToken: string,
    fileName: string,
    mediaKind: 'file' | 'image' | 'audio' | 'video',
    encryptedAttachment: {
      contentType: string
      size: number
      ciphertextBase64: string
    }
  ): Promise<string> {
    const ciphertextBytes = base64ToBytes(encryptedAttachment.ciphertextBase64)
    const chunkByteSize = 192 * 1024
    const partCount = Math.max(1, Math.ceil(ciphertextBytes.byteLength / chunkByteSize))
    const createUploadResponse = await createMediaUpload(sessionToken, {
      filename: fileName,
      content_type: encryptedAttachment.contentType,
      declared_byte_size: encryptedAttachment.size,
      media_kind: mediaKind,
      expected_part_count: partCount
    })
    const uploadId = createUploadResponse.upload.id
    let uploadedPartIndexes = new Set<number>(createUploadResponse.upload.uploaded_part_indexes ?? [])

    const uploadPartByIndex = async (partIndex: number) => {
      const start = partIndex * chunkByteSize
      const end = Math.min(start + chunkByteSize, ciphertextBytes.byteLength)
      const chunk = ciphertextBytes.subarray(start, end)
      const response = await appendMediaUploadPart(sessionToken, uploadId, {
        chunk: bytesToBase64(chunk),
        part_index: partIndex,
        part_count: partCount
      })
      uploadedPartIndexes = new Set(response.upload.uploaded_part_indexes ?? [])
    }

    for (let pass = 0; pass < 3; pass += 1) {
      for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
        if (uploadedPartIndexes.has(partIndex)) {
          continue
        }

        try {
          await uploadPartByIndex(partIndex)
        } catch (error) {
          if (pass >= 2) {
            throw error
          }

          const snapshot = await fetchMediaUploadState(sessionToken, uploadId)
          uploadedPartIndexes = new Set(snapshot.upload.uploaded_part_indexes ?? [])
        }
      }

      if (uploadedPartIndexes.size >= partCount) {
        break
      }
    }

    if (uploadedPartIndexes.size < partCount) {
      throw new Error('Attachment upload is missing one or more encrypted chunks.')
    }

    const ciphertextSha256 = await sha256Hex(ciphertextBytes)

    await completeMediaUpload(sessionToken, uploadId, {
      ciphertext_sha256: ciphertextSha256
    })
    return uploadId
  }

  async function sendAttachmentFile(file: File) {
    if (!storedDevice || !activeChatId) {
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: 'Encrypting and uploading attachment…' })

    const clientId = window.crypto.randomUUID()
    const optimisticId = `optimistic-${clientId}`
    const activeReplyToMessageId = replyTargetMessageId
    let thumbnailDataUrl: string | null = null
    let waveform: number[] | null = null

    try {
      thumbnailDataUrl = await generateAttachmentThumbnailDataUrl(file)
    } catch {
      thumbnailDataUrl = null
    }

    try {
      waveform = await generateAttachmentWaveform(file)
    } catch {
      waveform = null
    }

    const optimisticAttachment = {
      uploadId: 'pending',
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      thumbnailDataUrl: thumbnailDataUrl ?? undefined,
      waveform: waveform ?? undefined
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
      const uploadId = await uploadEncryptedAttachmentMultipart(
        storedDevice.sessionToken,
        file.name,
        inferMediaKind(file.type),
        encryptedAttachment
      )

      const descriptor: AttachmentDescriptor = {
        kind: 'attachment',
        uploadId,
        fileName: file.name,
        contentType: encryptedAttachment.contentType,
        size: encryptedAttachment.size,
        thumbnailDataUrl: thumbnailDataUrl ?? undefined,
        waveform: waveform ?? undefined,
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

      try {
        const response = await createMessage(storedDevice.sessionToken, activeChatId, payload)

        await ingestMessageIntoActiveThread(response.message, activeChatId)
        setBanner({
          tone: 'success',
          message:
            deliveryMode === 'group_sender_key'
              ? 'Encrypted attachment uploaded and delivered with Sender Key transport.'
              : 'Encrypted attachment uploaded and delivered with session transport.'
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send attachment.'

        if (shouldQueueOutboxSendFailure(message)) {
          await queueMessageForOutbox(activeChatId, payload, message)
          setBanner({
            tone: 'info',
            message: 'Attachment message queued for offline replay. It will retry automatically.'
          })
          return
        }

        throw error
      }
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

  async function handleAttachmentPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !storedDevice || !activeChatId) {
      return
    }

    await sendAttachmentFile(file)
  }

  async function handleVoiceNoteToggle() {
    if (voiceNoteRecording) {
      const recorder = voiceNoteRecorderRef.current

      if (!recorder) {
        cleanupVoiceNoteCapture()
        return
      }

      setBanner({ tone: 'info', message: 'Finishing voice note…' })
      recorder.stop()
      return
    }

    if (!activeChatId) {
      setBanner({ tone: 'error', message: 'Create or select a chat first.' })
      return
    }

    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      voiceNoteStreamRef.current = stream
      voiceNoteRecorderRef.current = recorder
      voiceNoteChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceNoteChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(voiceNoteChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        cleanupVoiceNoteCapture()

        if (blob.size === 0) {
          setBanner({ tone: 'error', message: 'Voice note recording was empty.' })
          return
        }

        const extension = (recorder.mimeType || 'audio/webm').includes('ogg') ? 'ogg' : 'webm'
        const file = new File([blob], `voice-note-${Date.now()}.${extension}`, {
          type: recorder.mimeType || 'audio/webm'
        })

        void sendAttachmentFile(file)
      }

      recorder.start()
      setVoiceNoteRecording(true)
      setBanner({ tone: 'info', message: 'Recording voice note… tap again to stop.' })
    } catch (error) {
      cleanupVoiceNoteCapture()
      const message = error instanceof Error ? error.message : 'Failed to start voice note recording.'
      setBanner({ tone: 'error', message })
    }
  }

  async function _handleRoundVideoToggle() {
    if (roundVideoRecording) {
      const recorder = roundVideoRecorderRef.current

      if (!recorder) {
        cleanupRoundVideoCapture()
        return
      }

      setBanner({ tone: 'info', message: 'Finishing round video…' })
      recorder.stop()
      return
    }

    if (!activeChatId) {
      setBanner({ tone: 'error', message: 'Create or select a chat first.' })
      return
    }

    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: 'user',
          width: { ideal: 480 },
          height: { ideal: 480 }
        }
      })
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
      roundVideoStreamRef.current = stream
      roundVideoRecorderRef.current = recorder
      roundVideoChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          roundVideoChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(roundVideoChunksRef.current, { type: recorder.mimeType || 'video/webm' })
        cleanupRoundVideoCapture()

        if (blob.size === 0) {
          setBanner({ tone: 'error', message: 'Round video recording was empty.' })
          return
        }

        const file = new File([blob], `round-video-${Date.now()}.webm`, {
          type: recorder.mimeType || 'video/webm'
        })

        void sendAttachmentFile(file)
      }

      recorder.start()
      setRoundVideoRecording(true)
      setBanner({ tone: 'info', message: 'Recording round video… tap again to stop.' })
    } catch (error) {
      cleanupRoundVideoCapture()
      const message = error instanceof Error ? error.message : 'Failed to start round video recording.'
      setBanner({ tone: 'error', message })
    }
  }

  async function ensureAttachmentPlaybackUrl(attachment: AttachmentDescriptor): Promise<string> {
    const existingUrl = attachmentPlaybackUrlsRef.current[attachment.uploadId]

    if (existingUrl) {
      return existingUrl
    }

    const inFlight = attachmentPlaybackInFlightRef.current.get(attachment.uploadId)

    if (inFlight) {
      return inFlight
    }

    if (!storedDevice) {
      throw new Error('No local device identity is available.')
    }

    const promise = (async () => {
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
      const playbackUrl = URL.createObjectURL(blob)

      setAttachmentPlaybackUrls((current) => {
        const previous = current[attachment.uploadId]

        if (previous && previous !== playbackUrl) {
          URL.revokeObjectURL(previous)
        }

        return {
          ...current,
          [attachment.uploadId]: playbackUrl
        }
      })

      return playbackUrl
    })()

    attachmentPlaybackInFlightRef.current.set(attachment.uploadId, promise)

    try {
      return await promise
    } finally {
      attachmentPlaybackInFlightRef.current.delete(attachment.uploadId)
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

  async function _handleQuickReaction(reactionKey: string) {
    if (!storedDevice || !activeChatId) {
      return
    }

    const targetMessage = [...messageItemsRef.current]
      .reverse()
      .find((message) => !message.id.startsWith('optimistic-') && !message.deletedAt)

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
    if (message.side === 'system' || message.deletedAt) {
      return
    }

    setEditingMessageId(null)
    setReplyTargetMessageId(message.id)
    draftInputRef.current?.focus()
  }

  function handleStartEditingMessage(message: CachedMessage) {
    if (message.side !== 'outgoing' || message.attachment || message.deletedAt) {
      return
    }

    setEditingMessageId(message.id)
    setReplyTargetMessageId(message.replyToMessageId ?? null)
    setDraft(message.text)
    draftInputRef.current?.focus()
  }

  async function handleDeleteExistingMessage(message: CachedMessage) {
    if (!storedDevice || !activeChatId || message.side !== 'outgoing' || message.deletedAt) {
      return
    }

    setLoading(true)

    try {
      const response = await deleteMessage(storedDevice.sessionToken, activeChatId, message.id)
      await ingestMessageIntoActiveThread(response.message, activeChatId)

      if (editingMessageId === message.id) {
        setEditingMessageId(null)
        setDraft('')
      }

      if (replyTargetMessageId === message.id) {
        setReplyTargetMessageId(null)
      }

      setBanner({ tone: 'success', message: 'Message deleted for this chat.' })
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to delete the message.'
      setBanner({ tone: 'error', message: messageText })
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleMessagePin(message: CachedMessage) {
    if (
      !storedDevice ||
      !activeChatId ||
      message.side === 'system' ||
      message.deletedAt ||
      message.id.startsWith('optimistic-')
    ) {
      return
    }

    setLoading(true)

    try {
      const response = await toggleMessagePin(storedDevice.sessionToken, activeChatId, message.id)
      await syncMessagesFromServerNow(activeChatId)
      setBanner({
        tone: 'success',
        message: response.message.pinned_at
          ? 'Pinned message updated for this chat.'
          : 'Pinned message cleared.'
      })
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to update the pinned message.'
      setBanner({ tone: 'error', message: messageText })
    } finally {
      setLoading(false)
    }
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
  const editingTargetMessage =
    editingMessageId
      ? messageItems.find((message) => message.id === editingMessageId) ?? null
      : null
  const replyTargetMessage =
    replyTargetMessageId
      ? messageItems.find((message) => message.id === replyTargetMessageId) ?? null
      : null
  const pinnedMessage = pickPinnedMessage(messageItems)
  const chatMediaItems = messageItems.filter((message) => message.attachment)
  const activeGroupChatId = activeChat?.type === 'group' ? activeChat.id : null
  const desktopWindowTitle = buildDesktopWindowTitle(activeChat?.title ?? null, activeCall?.mode ?? null)
  const appShellClassName = detailRailVisible ? 'app-shell' : 'app-shell app-shell--detail-hidden'
  const dominantRemoteEndpointId = pickDominantRemoteSpeakerEndpointId(membraneRemoteTracks)
  const featuredRemoteTrack = pickFeaturedRemoteTrack(membraneRemoteTracks, dominantRemoteEndpointId)
  const _dominantRemoteEndpoint = dominantRemoteEndpointId
    ? membraneRemoteEndpoints.find((endpoint) => endpoint.id === dominantRemoteEndpointId) ?? null
    : null
  const _remoteAudioTrackCount = membraneRemoteTracks.filter(
    (track) => track.ready && track.kind === 'audio'
  ).length
  const _remoteVideoTrackCount = membraneRemoteTracks.filter(
    (track) => track.ready && track.kind === 'video'
  ).length

  useEffect(() => {
    if (activeChat?.type === 'group') {
      setGroupRenameTitle(activeChat.title)
      return
    }

    setGroupRenameTitle('')
  }, [activeChat?.id, activeChat?.title, activeChat?.type])

  useEffect(() => {
    if (!storedDevice || view !== 'chat' || !activeGroupChatId) {
      setGroupMembers([])
      return
    }

    const { sessionToken } = storedDevice
    const groupChatId = activeGroupChatId
    let cancelled = false

    async function loadGroupMembers() {
      try {
        const response = await listGroupMembers(sessionToken, groupChatId)

        if (!cancelled) {
          setGroupMembers(response.members)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load group members.'
          setBanner({ tone: 'error', message })
          setGroupMembers([])
        }
      }
    }

    void loadGroupMembers()

    return () => {
      cancelled = true
    }
  }, [activeGroupChatId, storedDevice, view])

  useEffect(() => {
    if (!storedDevice || view !== 'chat' || !activeGroupChatId) {
      setGroupSenderKeys([])
      return
    }

    const { sessionToken } = storedDevice
    const encryptionPrivateKeyPkcs8Base64 = storedDevice.encryptionPrivateKeyPkcs8Base64
    const groupChatId = activeGroupChatId
    let cancelled = false

    async function loadGroupSenderKeys() {
      try {
        const response = await listGroupSenderKeys(sessionToken, groupChatId)

        if (!cancelled) {
          await storeInboundGroupSenderKeys(
            groupChatId,
            response.sender_keys,
            encryptionPrivateKeyPkcs8Base64
          )
          setGroupSenderKeys(response.sender_keys)
        }
      } catch {
        if (!cancelled) {
          setGroupSenderKeys([])
        }
      }
    }

    void loadGroupSenderKeys()

    return () => {
      cancelled = true
    }
  }, [activeGroupChatId, storedDevice, view])

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
        <div className="auth-card">
          <div className="auth-card__logo">
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="28" fill="var(--accent)" />
              <text x="28" y="34" textAnchor="middle" fill="white" fontSize="24" fontWeight="700">V</text>
            </svg>
          </div>
          <h1 className="auth-card__title">Vostok</h1>
          <p className="auth-card__subtitle">Secure messaging for everyone</p>

          <div className="auth-card__tabs">
            <button
              className={view === 'register' || view === 'welcome' ? 'auth-tab auth-tab--active' : 'auth-tab'}
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
              Link
            </button>
          </div>

          {banner ? (
            <div className={`status-banner status-banner--${banner.tone}`}>{banner.message}</div>
          ) : null}

          {view === 'welcome' || view === 'register' ? (
            <form className="auth-form" onSubmit={handleRegister}>
              <label className="auth-field">
                <span>Username</span>
                <input
                  autoComplete="username"
                  disabled={loading}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Choose a username"
                  required
                  value={username}
                />
              </label>

              <label className="auth-field">
                <span>Device name</span>
                <input
                  disabled={loading}
                  onChange={(event) => setDeviceName(event.target.value)}
                  placeholder="e.g. Safari on Mac"
                  required
                  value={deviceName}
                />
              </label>

              <button className="primary-action" disabled={loading} type="submit">
                {loading ? 'Creating...' : 'Create Account'}
              </button>
            </form>
          ) : null}

          {view === 'login' ? (
            <div className="auth-form">
              {storedDevice ? (
                <div className="auth-device-card">
                  <div className="auth-device-card__avatar" style={{ background: '#007AFF' }}>
                    {(storedDevice.username ?? 'U').slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <strong>{storedDevice.username}</strong>
                    <span style={{ fontSize: 13, color: 'var(--label2)' }}>{storedDevice.deviceName}</span>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 14, color: 'var(--label2)', textAlign: 'center' }}>No local device found. Register first.</p>
              )}

              <button
                className="primary-action"
                disabled={loading || !storedDevice}
                onClick={handleReauthenticate}
                type="button"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </div>
          ) : null}

          {view === 'link' ? (
            <div className="auth-form">
              <label className="auth-field">
                <span>Pairing code</span>
                <input disabled placeholder="Coming soon" value="" readOnly />
              </label>

              <button className="secondary-action" disabled type="button">
                Link Device
              </button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={appShellClassName}>
      <aside className="sidebar">
        <div className="sidebar__header">
          {desktopShell ? (
            <div
              className={
                desktopWindowFocused === false
                  ? 'desktop-titlebar desktop-titlebar--inactive'
                  : 'desktop-titlebar'
              }
            >
              <div className="desktop-titlebar__meta" data-tauri-drag-region>
                <strong>{desktopRuntime?.appName ?? 'Vostok'}</strong>
              </div>
              <div className="desktop-titlebar__actions">
                <button
                  aria-label="Minimize"
                  className="desktop-titlebar__button"
                  disabled={loading}
                  onClick={handleMinimizeDesktopHostWindow}
                  type="button"
                >
                  −
                </button>
                <button
                  aria-label={desktopWindowMaximized ? 'Restore' : 'Maximize'}
                  className="desktop-titlebar__button"
                  disabled={loading}
                  onClick={handleToggleDesktopWindowMaximize}
                  type="button"
                >
                  {desktopWindowMaximized ? '❐' : '□'}
                </button>
                <button
                  aria-label="Close"
                  className="desktop-titlebar__button"
                  disabled={loading}
                  onClick={handleCloseDesktopHostWindow}
                  type="button"
                >
                  ✕
                </button>
              </div>
            </div>
          ) : null}
          <div className="sidebar__title-row">
            <button
              className="sidebar__hamburger-btn"
              onClick={() => setDetailRailPreferred((current) => !current)}
              type="button"
              aria-label="Menu"
            >
              <svg width="20" height="16" viewBox="0 0 20 16" fill="none" aria-hidden="true">
                <path d="M1 2H19M1 8H19M1 14H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <span className="sidebar__title">Chats</span>
            <button
              className="sidebar__compose-btn"
              type="button"
              aria-label="New message"
              onClick={() => directChatInputRef.current?.focus()}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M13 2L16 5L6 15H3V12L13 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M11 4L14 7" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </div>
          <label className="search-bar">
            <span className="search-bar__icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <input
              className="search-bar__input"
              disabled={loading}
              onChange={(event) => setChatFilter(event.target.value)}
              placeholder="Search"
              ref={chatFilterInputRef}
              type="search"
              value={chatFilter}
              aria-label="Search chats"
            />
          </label>
          <form className="new-chat-form" onSubmit={handleCreateDirectChat} style={{ padding: '0 4px 4px' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                disabled={loading}
                onChange={(event) => setNewChatUsername(event.target.value)}
                placeholder="Start chat by username…"
                ref={directChatInputRef}
                value={newChatUsername}
                style={{
                  flex: 1, border: 'none', background: 'var(--fill)', borderRadius: 8,
                  padding: '8px 10px', fontSize: 13, fontFamily: 'var(--font)',
                  color: 'var(--label)', outline: 'none'
                }}
              />
              <button
                className="primary-action"
                disabled={loading || newChatUsername.trim() === ''}
                type="submit"
                style={{ padding: '8px 12px', fontSize: 13, borderRadius: 8 }}
              >
                Go
              </button>
            </div>
          </form>
        </div>
        <div className="sidebar__list">
          {visibleChatItems.length > 0 ? (
            visibleChatItems.map((chat, index) => (
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
                  avatarColor={chat.is_self_chat ? '#007AFF' : chat.type === 'group' ? '#4CD964' : '#5856D6'}
                  avatarInitial={chat.is_self_chat ? '🔖' : chat.title.slice(0, 1)}
                  isFirst={index === 0}
                />
              </button>
            ))
          ) : (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>💬</div>
              <p style={{ fontSize: 15, color: 'var(--label2)', margin: 0 }}>
                No chats yet
              </p>
              <p style={{ fontSize: 13, color: 'var(--label3)', margin: '4px 0 0' }}>
                Start a conversation above
              </p>
            </div>
          )}
        </div>
      </aside>

      <main className="conversation-pane">
        {banner ? <div className={`status-banner status-banner--${banner.tone}`}>{banner.message}</div> : null}
        <ConversationHeader
          title={activeChat?.title ?? 'Vostok'}
          subtitle={
            activeChat
              ? activeChat.is_self_chat
                ? 'Saved Messages'
                : activeChat.type === 'group'
                  ? `${groupMembers.length} members`
                  : 'last seen recently'
              : 'Select a chat to start messaging'
          }
          avatarColor={activeChat?.is_self_chat ? '#007AFF' : activeChat?.type === 'group' ? '#4CD964' : '#5856D6'}
          avatarInitial={activeChat?.is_self_chat ? '🔖' : activeChat?.title?.slice(0, 1)}
          online={activeChat != null && !activeChat.is_self_chat && activeChat.type !== 'group'}
          actions={activeChat ? (
            <>
              <button className="vostok-icon-button" type="button" aria-label="Voice call" disabled={loading} onClick={() => handleStartCall('voice')}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M17 14.2V16.5C17 17 16.6 17.4 16.1 17.5C15.7 17.5 15.3 17.5 14.9 17.5C8.3 17.5 3 12.2 3 5.6C3 5.2 3 4.8 3.1 4.4C3.1 3.9 3.5 3.5 4 3.5H6.3C6.7 3.5 7.1 3.8 7.2 4.2C7.3 4.8 7.5 5.3 7.7 5.8C7.8 6.1 7.7 6.4 7.5 6.6L6.5 7.6C7.5 9.4 9.1 11 10.9 12L11.9 11C12.1 10.8 12.4 10.7 12.7 10.8C13.2 11 13.7 11.2 14.3 11.3C14.7 11.4 15 11.8 15 12.2V14.2H17Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button className="vostok-icon-button" type="button" aria-label="Search" disabled={loading}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="M13 13L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
              <button className="vostok-icon-button" type="button" aria-label="More options" disabled={loading}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="5" r="1.5" fill="currentColor"/><circle cx="10" cy="10" r="1.5" fill="currentColor"/><circle cx="10" cy="15" r="1.5" fill="currentColor"/></svg>
              </button>
            </>
          ) : undefined}
        />

        <section className="conversation-stage">
          {pinnedMessage && !pinnedMessage.deletedAt ? (
            <div className="pinned-message-banner">
              <strong>{resolvePinnedPreview(pinnedMessage)}</strong>
            </div>
          ) : null}
          {!activeChat ? (
            <div className="conversation-stage__empty">
              <div style={{ fontSize: 48, marginBottom: 8 }}>💬</div>
              <p style={{ fontSize: 15, color: 'var(--label2)', margin: 0 }}>Select a chat to start messaging</p>
            </div>
          ) : messageItems.length === 0 ? (
            <div className="conversation-stage__empty">
              <p style={{ fontSize: 15, color: 'var(--label2)', margin: 0 }}>No messages here yet</p>
              <p style={{ fontSize: 13, color: 'var(--label3)', margin: '4px 0 0' }}>Send the first message to start the conversation</p>
            </div>
          ) : (
            <div className="message-thread">
              {messageItems.map((message) => {
                const linkUrl = extractFirstHttpUrl(message.text)
                const linkPreview = resolveLinkPreview(
                  message.text,
                  linkUrl ? linkMetadataByUrl[linkUrl] : null
                )
                const attachmentDescriptor =
                  message.attachment?.contentKeyBase64 && message.attachment.ivBase64
                    ? toAttachmentDescriptor(message.attachment)
                    : null

                return (
                <MessageBubble key={message.id} side={message.side} timestamp={formatRelativeTime(message.sentAt)}>
                  {message.replyToMessageId ? (
                    <span className="message-thread__reply-preview">
                      {resolveReplyPreview(messageItems, message.replyToMessageId)}
                    </span>
                  ) : null}
                  <span>{message.text}</span>
                  {linkPreview ? (
                    <a
                      className="message-thread__link-preview"
                      href={linkPreview.href}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="message-thread__link-domain">{linkPreview.hostname}</span>
                      <strong>{linkPreview.title}</strong>
                      <span>{linkPreview.description || linkPreview.href}</span>
                    </a>
                  ) : null}
                  {message.attachment?.thumbnailDataUrl ? (
                    <img
                      alt={message.attachment.fileName}
                      className={
                        isRoundVideoAttachment(message.attachment)
                          ? 'message-thread__attachment-preview message-thread__attachment-preview--round'
                          : 'message-thread__attachment-preview'
                      }
                      src={message.attachment.thumbnailDataUrl}
                    />
                  ) : null}
                  {message.attachment?.waveform && message.attachment.waveform.length > 0 && message.attachment &&
                  isVoiceNoteAttachment(message.attachment) ? (
                    <span className="message-thread__waveform" aria-label="Voice note waveform">
                      {message.attachment.waveform.map((level, index) => (
                        <span
                          className="message-thread__waveform-bar"
                          key={`${message.id}-waveform-${index}`}
                          style={{ height: `${Math.max(18, Math.round(level * 100))}%` }}
                        />
                      ))}
                    </span>
                  ) : null}
                  {attachmentDescriptor && message.attachment && isVoiceNoteAttachment(message.attachment) ? (
                    <VoiceNotePlayer
                      attachment={attachmentDescriptor}
                      onResolveMediaUrl={ensureAttachmentPlaybackUrl}
                    />
                  ) : null}
                  {attachmentDescriptor && message.attachment && isRoundVideoAttachment(message.attachment) ? (
                    <RoundVideoPlayer
                      attachment={attachmentDescriptor}
                      onResolveMediaUrl={ensureAttachmentPlaybackUrl}
                    />
                  ) : null}
                  {attachmentDescriptor ? (
                    <button
                      className="secondary-action"
                      onClick={() => handleDownloadAttachment(attachmentDescriptor)}
                      type="button"
                    >
                      Download {attachmentDescriptor.fileName}
                    </button>
                  ) : null}
                  {message.reactions && message.reactions.length > 0 ? (
                    <span className="message-thread__reactions">
                      {message.reactions
                        .map((reaction) => `${reaction.reactionKey} ${reaction.count}${reaction.reacted ? '*' : ''}`)
                        .join(' • ')}
                    </span>
                  ) : null}
                  {message.side !== 'system' && !message.deletedAt ? (
                    <div className="message-thread__actions">
                      <button className="mini-action" disabled={loading} onClick={() => handleReplyToMessage(message)} type="button">Reply</button>
                      {message.side === 'outgoing' && !message.attachment ? (
                        <button className="mini-action" disabled={loading} onClick={() => handleStartEditingMessage(message)} type="button">Edit</button>
                      ) : null}
                      {message.side === 'outgoing' ? (
                        <button className="mini-action" disabled={loading} onClick={() => handleDeleteExistingMessage(message)} type="button">Delete</button>
                      ) : null}
                      {!message.id.startsWith('optimistic-') ? (
                        <button className="mini-action" disabled={loading} onClick={() => handleToggleMessagePin(message)} type="button">{message.pinnedAt ? 'Unpin' : 'Pin'}</button>
                      ) : null}
                    </div>
                  ) : null}
                </MessageBubble>
                )
              })}
            </div>
          )}

        </section>

        {activeChat ? (
          <form className="live-composer" onSubmit={handleSendMessage}>
            <input hidden onChange={handleAttachmentPick} ref={fileInputRef} type="file" />
            <button className="live-composer__btn" type="button" aria-label="Attach file" disabled={loading} onClick={() => fileInputRef.current?.click()}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M18 10L10.5 17.5C8.5 19.5 5.5 19.5 3.5 17.5C1.5 15.5 1.5 12.5 3.5 10.5L11 3C12.5 1.5 15 1.5 16.5 3C18 4.5 18 7 16.5 8.5L9 16C8 17 6.5 17 5.5 16C4.5 15 4.5 13.5 5.5 12.5L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
            <div className="live-composer__field">
              {replyTargetMessageId ? (
                <div className="live-composer__reply">
                  <div className="live-composer__reply-copy">
                    <strong style={{ fontSize: 12, color: 'var(--accent)' }}>{editingMessageId ? 'Editing' : 'Reply'}</strong>
                    <span>{replyTargetMessage ? replyTargetMessage.text : 'Earlier message'}</span>
                  </div>
                  <button className="live-composer__btn live-composer__reply-clear" type="button" disabled={loading} onClick={() => setReplyTargetMessageId(null)} aria-label="Cancel reply">✕</button>
                </div>
              ) : null}
              {editingMessageId && !replyTargetMessageId ? (
                <div className="live-composer__reply">
                  <div className="live-composer__reply-copy">
                    <strong style={{ fontSize: 12, color: 'var(--accent)' }}>Editing</strong>
                    <span>{editingTargetMessage ? editingTargetMessage.text : 'Outgoing message'}</span>
                  </div>
                  <button className="live-composer__btn live-composer__reply-clear" type="button" disabled={loading} onClick={() => { setEditingMessageId(null); setDraft('') }} aria-label="Cancel edit">✕</button>
                </div>
              ) : null}
              <textarea
                className="live-composer__input"
                disabled={loading}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={editingMessageId ? 'Edit message…' : 'Message'}
                ref={draftInputRef}
                rows={1}
                value={draft}
              />
            </div>
            {draft.trim().length > 0 ? (
              <button className="live-composer__send" disabled={loading} type="submit" aria-label="Send">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 15V5M10 5L6 9M10 5L14 9" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            ) : (
              <button className="live-composer__btn" type="button" aria-label="Record voice message" disabled={loading} onClick={() => void handleVoiceNoteToggle()}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="8" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5"/><path d="M4 11C4 14.866 7.134 18 11 18C14.866 18 18 14.866 18 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M11 18V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            )}
          </form>
        ) : null}
      </main>

      <aside className={detailRailVisible ? 'detail-rail' : 'detail-rail detail-rail--hidden'}>
        <ChatInfoPanel
          title={activeChat?.title ?? profileUsername ?? storedDevice?.username ?? 'User'}
          phone="+7 999 555 01 10"
          handle={`@${activeChat?.title?.toLowerCase().replace(/\s+/g, '_') ?? profileUsername ?? storedDevice?.username ?? 'user'}`}
          avatarColor={activeChat?.is_self_chat ? '#007AFF' : activeChat?.type === 'group' ? '#4CD964' : '#5856D6'}
        />
        {chatMediaItems.length > 0 ? (
          <div className="settings-card">
            <div className="settings-card__header">
              <h3>Media</h3>
            </div>
            <div className="chat-media-gallery">
              {chatMediaItems.slice(-6).reverse().map((message) => (
                <button
                  key={message.id}
                  className="chat-media-gallery__item"
                  disabled={!message.attachment}
                  onClick={() => {
                    if (message.attachment) {
                      void handleDownloadAttachment(toAttachmentDescriptor(message.attachment))
                    }
                  }}
                  type="button"
                >
                  {message.attachment?.thumbnailDataUrl ? (
                    <img
                      alt={message.attachment.fileName}
                      className={
                        message.attachment && isRoundVideoAttachment(message.attachment)
                          ? 'chat-media-gallery__image chat-media-gallery__image--round'
                          : 'chat-media-gallery__image'
                      }
                      src={message.attachment.thumbnailDataUrl}
                    />
                  ) : (
                    <span className="chat-media-gallery__fallback">{message.attachment?.fileName}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {activeChat?.type === 'group' ? (
          <div className="settings-card">
            <div className="settings-card__header">
              <h3>Members</h3>
            </div>
            <div className="settings-card__list">
              {groupMembers.length > 0 ? (
                groupMembers.map((member) => (
                  <div key={member.user_id} className="settings-card__row">
                    <div className="settings-card__row-main">
                      <strong>{member.username}</strong>
                      <span>{member.role}{member.username === profileUsername ? ' · you' : ''}</span>
                    </div>
                    {member.username !== profileUsername ? (
                      <div className="settings-card__row-actions">
                        <button className="mini-action" disabled={loading} onClick={() => void handleRemoveActiveGroupMember(member)} type="button">Remove</button>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <span className="settings-card__muted">Loading members…</span>
              )}
            </div>
          </div>
        ) : null}
        <div className="settings-card">
          <div className="settings-card__header">
            <h3>Settings</h3>
          </div>
          <div className="settings-card__actions">
            <button className="secondary-action" disabled={loading} onClick={handleReauthenticate} type="button">
              Refresh Session
            </button>
            <button className="secondary-action" onClick={() => setView('link')} type="button">
              Link Another Device
            </button>
            <button className="danger-action" onClick={handleForgetDevice} type="button">
              Sign Out
            </button>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-card__header">
            <h3>Encryption</h3>
          </div>
          {safetyNumbers.length > 0 ? (
            <div className="settings-card__list">
              {safetyNumbers.map((entry) => (
                <div className="settings-card__row" key={entry.peerDeviceId}>
                  <div className="settings-card__row-main">
                    <strong>{entry.label}</strong>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>{entry.fingerprint}</span>
                  </div>
                  <div className="settings-card__row-actions">
                    {!entry.verified ? (
                      <button className="mini-action" disabled={verifyingSafetyDeviceId === entry.peerDeviceId || loading} onClick={() => void handleVerifyPeerSafetyNumber(entry.peerDeviceId)} type="button">Verify</button>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--green)' }}>Verified</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span className="settings-card__muted">No safety numbers available</span>
          )}
        </div>
        {/* Admin & call controls are accessible via dedicated settings screens */}
        {activeCall ? (
          <div className="settings-card">
            <div className="settings-card__header">
              <h3>Active Call</h3>
            </div>
            <div className="settings-card__actions">
              <button className="danger-action" disabled={loading} onClick={handleEndCall} type="button">End Call</button>
            </div>
            {featuredRemoteTrack ? (
              <div style={{ padding: '0 16px 16px' }}>
                <RemoteMembraneTrackPreview featured track={featuredRemoteTrack} />
              </div>
            ) : null}
          </div>
        ) : null}
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

function VoiceNotePlayer({
  attachment,
  onResolveMediaUrl
}: {
  attachment: AttachmentDescriptor
  onResolveMediaUrl: (attachment: AttachmentDescriptor) => Promise<string>
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [positionSeconds, setPositionSeconds] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [volume, setVolume] = useState(1)

  useEffect(() => {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    const syncPosition = () => setPositionSeconds(audio.currentTime || 0)
    const syncDuration = () => setDurationSeconds(Number.isFinite(audio.duration) ? audio.duration : 0)
    const syncPlaybackState = () => setPlaying(!audio.paused)

    audio.addEventListener('timeupdate', syncPosition)
    audio.addEventListener('loadedmetadata', syncDuration)
    audio.addEventListener('durationchange', syncDuration)
    audio.addEventListener('play', syncPlaybackState)
    audio.addEventListener('pause', syncPlaybackState)
    audio.addEventListener('ended', syncPlaybackState)

    audio.volume = volume
    audio.playbackRate = playbackRate

    return () => {
      audio.removeEventListener('timeupdate', syncPosition)
      audio.removeEventListener('loadedmetadata', syncDuration)
      audio.removeEventListener('durationchange', syncDuration)
      audio.removeEventListener('play', syncPlaybackState)
      audio.removeEventListener('pause', syncPlaybackState)
      audio.removeEventListener('ended', syncPlaybackState)
    }
  }, [playbackRate, volume])

  useEffect(() => {
    setMediaUrl(null)
    setError(null)
    setPlaying(false)
    setPositionSeconds(0)
    setDurationSeconds(0)
  }, [attachment.uploadId])

  async function handleLoad() {
    setLoading(true)
    setError(null)

    try {
      const resolved = await onResolveMediaUrl(attachment)
      setMediaUrl(resolved)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load the voice note.')
    } finally {
      setLoading(false)
    }
  }

  function handleTogglePlayback() {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    if (audio.paused) {
      void audio.play().catch(() => undefined)
      return
    }

    audio.pause()
  }

  function handleSeek(nextSeconds: number) {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    audio.currentTime = Math.max(0, Math.min(nextSeconds, durationSeconds || 0))
    setPositionSeconds(audio.currentTime)
  }

  if (!mediaUrl) {
    return (
      <div className="voice-note-player">
        <button className="secondary-action" disabled={loading} onClick={() => void handleLoad()} type="button">
          {loading ? 'Loading voice note…' : 'Play Voice Note'}
        </button>
        {error ? <span className="settings-card__muted">{error}</span> : null}
      </div>
    )
  }

  return (
    <div className="voice-note-player">
      <audio preload="metadata" ref={audioRef} src={mediaUrl} />
      <div className="voice-note-player__controls">
        <button className="mini-action" onClick={handleTogglePlayback} type="button">
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          className="mini-action"
          onClick={() => handleSeek(Math.max(0, positionSeconds - 10))}
          type="button"
        >
          -10s
        </button>
        <button
          className="mini-action"
          onClick={() => handleSeek(Math.min(durationSeconds || 0, positionSeconds + 10))}
          type="button"
        >
          +10s
        </button>
        <label className="voice-note-player__field">
          <span>{formatMediaClock(positionSeconds)} / {formatMediaClock(durationSeconds)}</span>
          <input
            max={Math.max(durationSeconds, 0.1)}
            min={0}
            onChange={(event) => handleSeek(Number(event.target.value))}
            step={0.1}
            type="range"
            value={Math.min(positionSeconds, durationSeconds || 0)}
          />
        </label>
      </div>
      <div className="voice-note-player__controls">
        <label className="voice-note-player__field">
          <span>Speed</span>
          <select
            onChange={(event) => setPlaybackRate(Number(event.target.value))}
            value={playbackRate}
          >
            <option value={0.75}>0.75x</option>
            <option value={1}>1.0x</option>
            <option value={1.25}>1.25x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2.0x</option>
          </select>
        </label>
        <label className="voice-note-player__field">
          <span>Volume</span>
          <input
            max={1}
            min={0}
            onChange={(event) => setVolume(Number(event.target.value))}
            step={0.05}
            type="range"
            value={volume}
          />
        </label>
      </div>
    </div>
  )
}

function RoundVideoPlayer({
  attachment,
  onResolveMediaUrl
}: {
  attachment: AttachmentDescriptor
  onResolveMediaUrl: (attachment: AttachmentDescriptor) => Promise<string>
}) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMediaUrl(null)
    setError(null)
  }, [attachment.uploadId])

  async function handleLoad() {
    setLoading(true)
    setError(null)

    try {
      const resolved = await onResolveMediaUrl(attachment)
      setMediaUrl(resolved)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load round video.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="round-video-player">
      {!mediaUrl ? (
        <button className="secondary-action" disabled={loading} onClick={() => void handleLoad()} type="button">
          {loading ? 'Loading round video…' : 'Play Round Video'}
        </button>
      ) : (
        <video className="round-video-player__video" controls playsInline preload="metadata" src={mediaUrl} />
      )}
      {error ? <span className="settings-card__muted">{error}</span> : null}
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
      pinnedAt: message.pinned_at ?? undefined,
      side: 'system',
      decryptable: true,
      reactions: message.reactions.map((reaction) => ({
        reactionKey: reaction.reaction_key,
        count: reaction.count,
        reacted: reaction.reacted
      }))
    }
  }

  if (message.deleted_at) {
    return {
      id: message.id,
      clientId: message.client_id,
      replyToMessageId: message.reply_to_message_id ?? undefined,
      text: 'Message deleted',
      sentAt: message.inserted_at,
      pinnedAt: message.pinned_at ?? undefined,
      editedAt: message.edited_at ?? undefined,
      deletedAt: message.deleted_at,
      side: message.sender_device_id === currentDeviceId ? 'outgoing' : 'incoming',
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
      pinnedAt: message.pinned_at ?? undefined,
      editedAt: message.edited_at ?? undefined,
      deletedAt: message.deleted_at ?? undefined,
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
      replyToMessageId: message.reply_to_message_id ?? undefined,
      text: '[Encrypted envelope available but not decryptable on this device]',
      sentAt: message.inserted_at,
      pinnedAt: message.pinned_at ?? undefined,
      editedAt: message.edited_at ?? undefined,
      deletedAt: message.deleted_at ?? undefined,
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
      .filter(
        (session) =>
          session.initiator_device_id === storedDevice.deviceId &&
          session.session_state !== 'superseded'
      )
      .map((session) => session.recipient_device_id)
  )

  return recipientDevices.every((device) => outboundRecipientIds.has(device.device_id))
}

function shouldQueueOutboxSendFailure(message: string): boolean {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('required') ||
    normalized.includes('must ') ||
    normalized.includes('must be') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('not found') ||
    normalized.includes('sender key') ||
    normalized.includes('session transport') ||
    normalized.includes('already been taken')
  ) {
    return false
  }

  return true
}

function isOutboxDuplicateClientIdError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('client') && normalized.includes('already been taken')
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
      (typeof parsed.waveform === 'undefined' ||
        (Array.isArray(parsed.waveform) && parsed.waveform.every((value) => typeof value === 'number'))) &&
      typeof parsed.contentKeyBase64 === 'string' &&
      typeof parsed.ivBase64 === 'string'
    ) {
      return {
        text:
          parsed.contentType.startsWith('audio/') && parsed.fileName.startsWith('voice-note-')
            ? `Voice note: ${parsed.fileName}`
            : parsed.contentType.startsWith('video/') && parsed.fileName.startsWith('round-video-')
              ? `Round video: ${parsed.fileName}`
            : `Attachment: ${parsed.fileName}`,
        attachment: {
          uploadId: parsed.uploadId,
          fileName: parsed.fileName,
          contentType: parsed.contentType,
          size: parsed.size,
          thumbnailDataUrl: parsed.thumbnailDataUrl,
          waveform: parsed.waveform as number[] | undefined,
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
    waveform: attachment.waveform,
    contentKeyBase64: attachment.contentKeyBase64,
    ivBase64: attachment.ivBase64
  }
}

function isVoiceNoteAttachment(
  attachment: Pick<NonNullable<CachedMessage['attachment']>, 'fileName' | 'contentType'>
): boolean {
  return attachment.contentType.startsWith('audio/') && attachment.fileName.startsWith('voice-note-')
}

function isRoundVideoAttachment(
  attachment: Pick<NonNullable<CachedMessage['attachment']>, 'fileName' | 'contentType'>
): boolean {
  return attachment.contentType.startsWith('video/') && attachment.fileName.startsWith('round-video-')
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

function pickPinnedMessage(messages: CachedMessage[]): CachedMessage | null {
  const pinnedMessages = messages.filter((message) => message.pinnedAt && !message.deletedAt)

  if (pinnedMessages.length === 0) {
    return null
  }

  return [...pinnedMessages].sort((left, right) => {
    const leftTime = Date.parse(left.pinnedAt ?? left.sentAt)
    const rightTime = Date.parse(right.pinnedAt ?? right.sentAt)

    if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
      return (right.pinnedAt ?? right.sentAt).localeCompare(left.pinnedAt ?? left.sentAt)
    }

    return rightTime - leftTime
  })[0]
}

function resolvePinnedPreview(message: CachedMessage): string {
  const preview = message.text.trim()

  if (preview.length === 0) {
    return 'Encrypted message'
  }

  return preview.length > 96 ? `${preview.slice(0, 93)}...` : preview
}

function extractFirstHttpUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i)

  if (!match) {
    return null
  }

  try {
    return new URL(match[0]).href
  } catch {
    return null
  }
}

function resolveLinkPreview(
  text: string,
  metadata: LinkMetadata | null
): { href: string; hostname: string; title: string; description: string | null } | null {
  const href = extractFirstHttpUrl(text)

  if (!href) {
    return null
  }

  try {
    const url = new URL(href)
    const hostname = url.hostname.replace(/^www\./i, '')
    const fallbackPath = url.pathname === '/' ? '' : url.pathname
    const fallbackTitle = `${hostname}${fallbackPath}`.slice(0, 96) || href
    const title = metadata?.title?.trim() || fallbackTitle
    const description = metadata?.description?.trim() || metadata?.canonical_url?.trim() || null

    return {
      href,
      hostname: metadata?.hostname || hostname,
      title,
      description
    }
  } catch {
    return null
  }
}

function toSafetyNumberEntry(record: SafetyNumberRecord): SafetyNumberEntry {
  return {
    peerDeviceId: record.peer_device_id,
    peerUsername: record.peer_username,
    peerDeviceName: record.peer_device_name,
    label: `${record.peer_username} • ${record.peer_device_name}`,
    fingerprint: record.fingerprint,
    verified: record.verified,
    verifiedAt: record.verified_at
  }
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

function formatMediaClock(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '0:00'
  }

  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function mergeCallSignals(current: CallSignal[], nextSignal: CallSignal): CallSignal[] {
  return [...current.filter((signal) => signal.id !== nextSignal.id), nextSignal]
    .sort((left, right) => left.inserted_at.localeCompare(right.inserted_at))
    .slice(-12)
}

function readMembraneNativeEventType(eventPayload: string): string | null {
  try {
    const parsed = JSON.parse(eventPayload) as {
      type?: unknown
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

function _truncateSignalPayload(payload: string): string {
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
