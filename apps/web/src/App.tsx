import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { GlassSurface } from '@vostok/ui-primitives'
import {
  CallSurface,
  ChatInfoPanel,
  ChatListItem,
  ConversationHeader,
  MessageBubble
} from '@vostok/ui-chat'
import {
  attemptFederationDelivery,
  createCallSession,
  createFederationDelivery,
  createFederationPeer,
  createFederationPeerInvite,
  recordFederationPeerHeartbeat,
  endCallSession,
  fetchCallWebRtcEndpointState,
  fetchCallState,
  fetchAdminOverview,
  fetchActiveCall,
  fetchCallKeys,
  listDevices,
  listFederationDeliveries,
  fetchTurnCredentials,
  joinCallSession,
  listRecipientDevices,
  listFederationPeers,
  leaveCallSession,
  pollCallWebRtcMediaEvents,
  provisionCallWebRtcEndpoint,
  pushCallWebRtcMediaEvent,
  revokeDevice,
  updateFederationPeerStatus,
  rotateCallKeys,
  type AdminOverview,
  type CallParticipant,
  type CallKeyDistribution,
  type CallRoomState,
  type CallSignal,
  type CallSession,
  type CallWebRtcEndpointState,
  type DeviceInfo,
  type FederationDeliveryJob,
  type FederationPeer,
  type TurnCredentials
} from './lib/api'

import { subscribeToCallStream } from './lib/realtime'
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
import { isDesktopShell, setDesktopWindowTitle } from './lib/desktop-shell'
import { wrapGroupSenderKeyForRecipients } from './lib/message-vault'
import { bytesToBase64 } from './lib/base64'
import { NoConversation } from './features/empty-state/NoConversation'
import { OnboardingStack } from './features/onboarding/OnboardingStack'
import { InviteShareSheet } from './features/invite/InviteShareSheet'
import { ComposeView } from './features/compose/ComposeView'
import { NewGroupView } from './features/compose/NewGroupView'
import { SettingsView } from './features/settings/SettingsView'
import { useAppNav } from './shared/hooks/useNavigation'
import {
  resolveReplyPreview,
  toAttachmentDescriptor,
  isVoiceNoteAttachment,
  isRoundVideoAttachment,
  extractFirstHttpUrl,
  resolveLinkPreview,
  formatRelativeTime,
  formatMediaClock,
  truncateSignalPayload,
  pickPinnedMessage,
  resolvePinnedPreview,
} from './shared/lib/chat-utils'
import { useDesktopWindow } from './shared/hooks/useDesktopWindow'
import { useAuthState } from './shared/hooks/useAuth'
import { useChatList } from './shared/hooks/useChatList'
import { useConversation } from './shared/hooks/useConversation'
import { AuthContext } from './shared/context/AuthContext'
import { ChatContext } from './shared/context/ChatContext'



export type { Banner, SafetyNumberEntry, AttachmentDescriptor } from './shared/types/chat'
import type { Banner, AttachmentDescriptor } from './shared/types/chat'



function App() {
  const [loading, setLoading] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [devices, setDevices] = useState<DeviceInfo[]>([])



  const auth = useAuthState({ setLoading, setBanner, onRefreshDeviceList: refreshDeviceList })
  const {
    storedDevice, setStoredDevice,
    view, setView,
    profileUsername,
    isAdmin, setIsAdmin,
    showInviteSheet, setShowInviteSheet,
    showOnboardingTip, setShowOnboardingTip,
    handleReauthenticate,
    handleRotatePrekeys,
    handleAuthenticated,
    clearAuthState,
  } = auth
  const sidebarNav = useAppNav('chat-list')
  const desktop = useDesktopWindow({ setLoading, setBanner })
  const {
    isDesktopWide,
    desktopShell,
    desktopRuntime,
    desktopWindowMaximized,
    desktopWindowFocused,
    desktopWindowAlwaysOnTop,
    desktopWindowFullscreen,
    desktopWindowGeometry,
    detailRailPreferred,
    setDetailRailPreferred,
    handleRefreshDesktopRuntime,
    handleToggleDesktopWindowMaximize,
    handleMinimizeDesktopHostWindow,
    handleCloseDesktopHostWindow,
    handleToggleDesktopAlwaysOnTop,
    handleToggleDesktopFullscreen,
    handleCopyDesktopDiagnostics,
    handleResetDesktopHostWindowFrame,
  } = desktop

  const chatList = useChatList({
    storedDevice,
    view,
    profileUsername,
    setLoading,
    setBanner,
    onDevicesLoaded: setDevices,
    onIsAdminResolved: setIsAdmin,
    onProfileUsernameResolved: () => { /* profileUsername managed by useAuthState */ },
  })
  const {
    chatItems, setChatItems,
    chatFilter, setChatFilter,
    activeChatId, setActiveChatId,
    deferredActiveChatId,
    activeChat,
    visibleChatItems,
    contacts,
    chatButtonRefs,
    chatFilterInputRef,
    directChatInputRef,
    groupTitleInputRef,
    handleCreateDirectChatByUsername,
    handleCreateGroupFromNav,
    focusRelativeChat,
    setNewChatUsername,
    setNewGroupTitle,
    setNewGroupMembers,
    reset: resetChatList,
  } = chatList

  const conversation = useConversation({
    storedDevice,
    setStoredDevice,
    activeChatId,
    deferredActiveChatId,
    activeChat,
    chatItems,
    view,
    setLoading,
    setBanner,
    onChatItemsChange: setChatItems,
  })
  const {
    messageItems,
    draft, setDraft,
    editingMessageId, setEditingMessageId,
    replyTargetMessageId, setReplyTargetMessageId,
    voiceNoteRecording,
    roundVideoRecording,
    groupRenameTitle, setGroupRenameTitle,
    groupMembers,
    groupSenderKeys,
    chatSessions,
    remotePrekeyBundles,
    safetyNumbers,
    verifyingSafetyDeviceId,
    outboxPendingCount,
    linkMetadataByUrl,
    attachmentPlaybackUrls,
    fileInputRef,
    draftInputRef,
    sendDraftMessage,
    handleSendMessage,
    handleAttachmentPick,
    handleVoiceNoteToggle,
    handleRoundVideoToggle,
    handleReplyToMessage,
    handleStartEditingMessage,
    handleDeleteExistingMessage,
    handleToggleMessagePin,
    handleDownloadAttachment,
    ensureAttachmentPlaybackUrl,
    handleVerifyPeerSafetyNumber,
    handleRekeyActiveChatSessions,
    handleRenameActiveGroupChat,
    handleUpdateActiveGroupMemberRole,
    handleRemoveActiveGroupMember,
    handleRotateGroupSenderKey,
    reset: resetConversation,
  } = conversation
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null)
  const [federationPeers, setFederationPeers] = useState<FederationPeer[]>([])
  const [federationDeliveries, setFederationDeliveries] = useState<FederationDeliveryJob[]>([])
  const [federationDomain, setFederationDomain] = useState('')
  const [federationDisplayName, setFederationDisplayName] = useState('')
  const [federationInviteToken, setFederationInviteToken] = useState<string | null>(null)
  const [turnCredentials, setTurnCredentials] = useState<TurnCredentials | null>(null)
  const [activeCall, setActiveCall] = useState<CallSession | null>(null)
  const [callParticipants, setCallParticipants] = useState<CallParticipant[]>([])
  const [callKeys, setCallKeys] = useState<CallKeyDistribution[]>([])
  const [callRoom, setCallRoom] = useState<CallRoomState | null>(null)
  const [callWebRtcEndpoint, setCallWebRtcEndpoint] = useState<CallWebRtcEndpointState | null>(null)
  const [callWebRtcMediaEvents, setCallWebRtcMediaEvents] = useState<string[]>([])
  const [callSignals, setCallSignals] = useState<CallSignal[]>([])
  const [localMediaMode, setLocalMediaMode] = useState<'none' | 'audio' | 'audio_video'>('none')
  const [localAudioTrackCount, setLocalAudioTrackCount] = useState(0)
  const [localVideoTrackCount, setLocalVideoTrackCount] = useState(0)
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

  const callSignalsRef = useRef<CallSignal[]>([])
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





  function handleForgetDevice() {
    clearAuthState()
    resetChatList()
    resetConversation()
    setDevices([])
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
  }



  useEffect(() => {
    callSignalsRef.current = callSignals
  }, [callSignals])















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
        void handleCopyDesktopDiagnostics({ desktopWindowTitle, detailRailVisible, activeChatId, activeChatTitle: activeChat?.title ?? null })
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
















  async function handleRevokeLinkedDevice(deviceId: string) {
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

  async function handleRotateCallKeyEpoch() {
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

  async function handleInitializeWebRtc() {
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

  async function handleAttachLocalMedia(mode: 'audio' | 'audio_video') {
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

  async function handleReleaseLocalMedia() {
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


























  const onboarding = view !== 'chat'
  const activeGroupChatId = activeChat?.type === 'group' ? activeChat.id : null
  const detailRailVisible = detailRailPreferred && isDesktopWide
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
  const desktopWindowTitle = buildDesktopWindowTitle(activeChat?.title ?? null, activeCall?.mode ?? null)
  const appShellClassName = detailRailVisible ? 'app-shell' : 'app-shell app-shell--detail-hidden'
  const dominantRemoteEndpointId = pickDominantRemoteSpeakerEndpointId(membraneRemoteTracks)
  const featuredRemoteTrack = pickFeaturedRemoteTrack(membraneRemoteTracks, dominantRemoteEndpointId)
  const dominantRemoteEndpoint = dominantRemoteEndpointId
    ? membraneRemoteEndpoints.find((endpoint) => endpoint.id === dominantRemoteEndpointId) ?? null
    : null
  const remoteAudioTrackCount = membraneRemoteTracks.filter(
    (track) => track.ready && track.kind === 'audio'
  ).length
  const remoteVideoTrackCount = membraneRemoteTracks.filter(
    (track) => track.ready && track.kind === 'video'
  ).length

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
      <OnboardingStack
        onAuthenticated={handleAuthenticated}
      />
    )
  }

  return (
    <AuthContext.Provider value={{
      storedDevice,
      profileUsername,
      isAdmin,
      showInviteSheet,
      setShowInviteSheet,
      showOnboardingTip,
      setShowOnboardingTip,
      handleReauthenticate,
      handleRotatePrekeys,
      handleForgetDevice,
      handleRevokeLinkedDevice,
      devices,
      outboxPendingCount,
    }}>
    <ChatContext.Provider value={{
      chatItems, setChatItems,
      chatFilter, setChatFilter,
      activeChatId, setActiveChatId,
      activeChat,
      visibleChatItems,
      contacts,
      chatButtonRefs,
      chatFilterInputRef,
      handleCreateDirectChatByUsername,
      handleCreateGroupFromNav,
      focusRelativeChat,
      messageItems,
      draft, setDraft,
      editingMessageId, setEditingMessageId,
      replyTargetMessageId, setReplyTargetMessageId,
      editingTargetMessage,
      replyTargetMessage,
      pinnedMessage,
      chatMediaItems,
      voiceNoteRecording,
      roundVideoRecording,
      groupRenameTitle, setGroupRenameTitle,
      groupMembers,
      groupSenderKeys,
      safetyNumbers,
      linkMetadataByUrl,
      attachmentPlaybackUrls,
      outboxPendingCount,
      fileInputRef,
      draftInputRef,
      handleSendMessage,
      handleAttachmentPick,
      handleVoiceNoteToggle,
      handleRoundVideoToggle,
      handleReplyToMessage,
      handleStartEditingMessage,
      handleDeleteExistingMessage,
      handleToggleMessagePin,
      handleDownloadAttachment,
      ensureAttachmentPlaybackUrl,
      handleVerifyPeerSafetyNumber,
      handleRekeyActiveChatSessions,
      handleRenameActiveGroupChat,
      handleUpdateActiveGroupMemberRole,
      handleRemoveActiveGroupMember,
      handleRotateGroupSenderKey,
    }}>
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
          <div className="sidebar__title-row">
            <button
              aria-label="Settings"
              className="vostok-icon-button sidebar__hamburger"
              type="button"
              onClick={() => sidebarNav.push('settings')}
            >
              <span className="vostok-icon-button__glyph">☰</span>
            </button>
            <h1>Chats</h1>
            <div className="sidebar__title-row-actions">
              <div className="sidebar__compose-wrap">
                <button
                  aria-label="New message"
                  className="vostok-icon-button sidebar__compose-btn"
                  type="button"
                  onClick={() => sidebarNav.push('compose')}
                >
                  <span className="vostok-icon-button__glyph">✏</span>
                </button>
                {showOnboardingTip ? (
                  <div className="onboarding-tip" role="tooltip">
                    Start a conversation.
                    <button
                      className="onboarding-tip__close"
                      type="button"
                      onClick={() => setShowOnboardingTip(false)}
                      aria-label="Dismiss tip"
                    >
                      ×
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        {/* ── Sidebar nav body ─────────────────────────────── */}
        {sidebarNav.current === 'chat-list' ? (
          <>
            <div className="sidebar-search">
              <input
                className="sidebar-search__input"
                disabled={loading}
                onChange={(event) => setChatFilter(event.target.value)}
                placeholder="Search…"
                ref={chatFilterInputRef}
                value={chatFilter}
              />
              {chatFilter.trim() !== '' ? (
                <button
                  className="sidebar-search__clear"
                  type="button"
                  onClick={() => setChatFilter('')}
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
            </div>
            <div className="sidebar__list">
              {visibleChatItems.length > 0 ? (
                visibleChatItems.map((chat) => (
                  <button
                    key={chat.id}
                    className="chat-list-button"
                    onClick={() => {
                      setActiveChatId(chat.id)
                    }}
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
                <span className="settings-card__muted">
                  {chatFilter.trim() !== '' ? 'No chats match.' : 'No conversations yet. Tap ✏ to start one.'}
                </span>
              )}
            </div>
          </>
        ) : sidebarNav.current === 'compose' ? (
          <ComposeView
            nav={sidebarNav}
            contacts={contacts}
            loading={loading}
            onStartChat={(username) => {
              setNewChatUsername(username)
              void handleCreateDirectChatByUsername(username)
            }}
          />
        ) : sidebarNav.current === 'new-group' ? (
          <NewGroupView
            nav={sidebarNav}
            loading={loading}
            onCreateGroup={(title, members) => {
              setNewGroupTitle(title)
              setNewGroupMembers(members.join(','))
              void handleCreateGroupFromNav(title, members)
            }}
          />
        ) : sidebarNav.current === 'settings' ? (
          <SettingsView
            nav={sidebarNav}
            profileUsername={profileUsername}
            storedDevice={storedDevice}
            devices={devices}
            outboxPendingCount={outboxPendingCount}
            isAdmin={isAdmin}
            loading={loading}
            onRevokeDevice={(deviceId) => void handleRevokeLinkedDevice(deviceId)}
            onRotatePrekeys={handleRotatePrekeys}
            onRefreshSession={handleReauthenticate}
            onForgetDevice={handleForgetDevice}
            onShowInviteSheet={() => setShowInviteSheet(true)}
          />
        ) : null}
      </aside>

      <main className="conversation-pane">
        {banner ? <div className={`status-banner status-banner--${banner.tone}`}>{banner.message}</div> : null}
        {activeChatId ? (
        <>
        <ConversationHeader
          title={activeChat?.title ?? ''}
          subtitle={activeChat?.is_self_chat ? 'Your notes' : ''}
        />

        <section className="conversation-stage">
          {pinnedMessage && !pinnedMessage.deletedAt ? (
            <GlassSurface className="pinned-message-banner">
              <span className="sidebar__eyebrow">Pinned message</span>
              <strong>{resolvePinnedPreview(pinnedMessage)}</strong>
              <span>{formatRelativeTime(pinnedMessage.pinnedAt ?? pinnedMessage.sentAt)}</span>
            </GlassSurface>
          ) : null}
          {messageItems.length === 0 ? (
            <MessageBubble className="conversation-stage__hero" side="system">
              <strong className="hero-card__title">No messages here yet</strong>
              <span className="hero-card__copy">Send the first message.</span>
            </MessageBubble>
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
                <MessageBubble key={message.id} side={message.side}>
                  {message.replyToMessageId ? (
                    <span className="message-thread__reply-preview">
                      Replying to {resolveReplyPreview(messageItems, message.replyToMessageId)}
                    </span>
                  ) : null}
                  <strong>{message.text}</strong>
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
                  {message.side !== 'system' ? (
                    <div className="message-thread__actions">
                      {!message.deletedAt ? (
                        <button
                          className="secondary-action"
                          disabled={loading}
                          onClick={() => handleReplyToMessage(message)}
                          type="button"
                        >
                          Reply
                        </button>
                      ) : null}
                      {message.side === 'outgoing' && !message.attachment && !message.deletedAt ? (
                        <button
                          className="secondary-action"
                          disabled={loading}
                          onClick={() => handleStartEditingMessage(message)}
                          type="button"
                        >
                          Edit
                        </button>
                      ) : null}
                      {message.side === 'outgoing' && !message.deletedAt ? (
                        <button
                          className="secondary-action"
                          disabled={loading}
                          onClick={() => handleDeleteExistingMessage(message)}
                          type="button"
                        >
                          Delete
                        </button>
                      ) : null}
                      {!message.id.startsWith('optimistic-') && !message.deletedAt ? (
                        <button
                          className="secondary-action"
                          disabled={loading}
                          onClick={() => handleToggleMessagePin(message)}
                          type="button"
                        >
                          {message.pinnedAt ? 'Unpin' : 'Pin'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <span className="message-thread__meta">
                    {formatRelativeTime(message.sentAt)}
                    {message.pinnedAt ? ' • pinned' : ''}
                    {message.editedAt ? ' • edited' : ''}
                    {message.deletedAt ? ' • deleted' : ''}
                  </span>
                </MessageBubble>
                )
              })}
            </div>
          )}

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
          <button
            className="vostok-icon-button"
            type="button"
            aria-label={voiceNoteRecording ? 'Stop voice note recording' : 'Record voice note'}
            disabled={loading || !activeChat}
            onClick={() => void handleVoiceNoteToggle()}
          >
            <span className="vostok-icon-button__glyph">{voiceNoteRecording ? 'S' : 'M'}</span>
          </button>
          <button
            className="vostok-icon-button"
            type="button"
            aria-label={roundVideoRecording ? 'Stop round video recording' : 'Record round video'}
            disabled={loading || !activeChat}
            onClick={() => void handleRoundVideoToggle()}
          >
            <span className="vostok-icon-button__glyph">{roundVideoRecording ? 'S' : 'V'}</span>
          </button>
          <GlassSurface className="live-composer__field">
            {replyTargetMessageId ? (
              <div className="live-composer__reply">
                <div className="live-composer__reply-copy">
                  <strong>{editingMessageId ? 'Editing reply' : 'Replying'}</strong>
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
            {editingMessageId && !replyTargetMessageId ? (
              <div className="live-composer__reply">
                <div className="live-composer__reply-copy">
                  <strong>Editing message</strong>
                  <span>{editingTargetMessage ? editingTargetMessage.text : 'Outgoing message'}</span>
                </div>
                <button
                  className="vostok-icon-button live-composer__reply-clear"
                  disabled={loading}
                  onClick={() => {
                    setEditingMessageId(null)
                    setDraft('')
                  }}
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
              placeholder={
                activeChat
                  ? editingMessageId
                    ? 'Edit the encrypted envelope…'
                    : 'Write an encrypted envelope…'
                  : 'Create a chat first'
              }
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
            {editingMessageId ? 'Save' : 'Send'}
          </button>
        </form>
        </>
        ) : (
          <NoConversation />
        )}
      </main>

      <aside className={detailRailVisible ? 'detail-rail' : 'detail-rail detail-rail--hidden'}>
        <ChatInfoPanel
          title={profileUsername ?? storedDevice?.username ?? 'Dinosaur'}
          phone="+7 999 555 01 10"
          handle={`@${profileUsername ?? storedDevice?.username ?? 'dinosaur'}`}
        />
        <GlassSurface className="settings-card">
          <div className="settings-card__header">
            <span className="sidebar__eyebrow">Media</span>
            <h3>Chat gallery</h3>
          </div>
          {chatMediaItems.length > 0 ? (
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
          ) : (
            <span className="settings-card__muted">No attachments in the current chat yet.</span>
          )}
        </GlassSurface>
        {activeChat?.type === 'group' ? (
          <GlassSurface className="settings-card">
            <div className="settings-card__header">
              <span className="sidebar__eyebrow">Group</span>
              <h3>Admin controls</h3>
            </div>
            <form className="new-chat-form" onSubmit={handleRenameActiveGroupChat}>
              <label className="auth-field">
                <span>Group title</span>
                <input
                  disabled={loading}
                  onChange={(event) => setGroupRenameTitle(event.target.value)}
                  placeholder="Operators"
                  value={groupRenameTitle}
                />
              </label>
              <button
                className="secondary-action"
                disabled={loading || groupRenameTitle.trim() === '' || groupRenameTitle === activeChat.title}
                type="submit"
              >
                Save Group Title
              </button>
            </form>
            <div className="device-summary-card">
              <strong>Members</strong>
              {groupMembers.length > 0 ? (
                groupMembers.map((member) => (
                  <span key={member.user_id}>
                    {member.username} • {member.role}
                    {member.username === profileUsername ? ' • you' : ''}
                  </span>
                ))
              ) : (
                <span>Loading members…</span>
              )}
            </div>
            <div className="settings-card__actions">
              {groupMembers.map((member) => {
                const isSelf = member.username === profileUsername

                return (
                  <div key={member.user_id} className="settings-card__row">
                    <div className="settings-card__row-main">
                      <strong>{member.username}</strong>
                      <span>
                        {member.role}
                        {isSelf ? ' • you' : ''}
                      </span>
                    </div>
                    {!isSelf ? (
                      <div className="settings-card__row-actions">
                        <button
                          className="secondary-action"
                          disabled={loading || member.role === 'admin'}
                          onClick={() => void handleUpdateActiveGroupMemberRole(member, 'admin')}
                          type="button"
                        >
                          Promote
                        </button>
                        <button
                          className="secondary-action"
                          disabled={loading || member.role === 'member'}
                          onClick={() => void handleUpdateActiveGroupMemberRole(member, 'member')}
                          type="button"
                        >
                          Demote
                        </button>
                        <button
                          className="danger-action"
                          disabled={loading}
                          onClick={() => void handleRemoveActiveGroupMember(member)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <span className="settings-card__muted">Self-management stays manual for now.</span>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="settings-card__actions">
              <button
                className="secondary-action"
                disabled={loading || !activeGroupChatId}
                onClick={() => void handleRotateGroupSenderKey()}
                type="button"
              >
                Rotate Sender Key
              </button>
            </div>
            <div className="settings-card__list">
              {groupSenderKeys.length === 0 ? (
                <span className="settings-card__muted">
                  No inbound Sender Keys are currently queued for this device.
                </span>
              ) : (
                groupSenderKeys.slice(0, 4).map((senderKey) => (
                  <div className="settings-card__row" key={senderKey.id}>
                    <div className="settings-card__row-main">
                      <strong>{senderKey.key_id}</strong>
                      <span>
                        {senderKey.algorithm} • {senderKey.status}
                      </span>
                      <span>{formatRelativeTime(senderKey.updated_at ?? senderKey.inserted_at)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </GlassSurface>
        ) : null}
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
            <span>
              Offline outbox: {outboxPendingCount} pending message
              {outboxPendingCount === 1 ? '' : 's'}
            </span>
          </div>
          <div className="settings-card__list">
            {devices.length === 0 ? (
              <span className="settings-card__muted">No linked devices found yet.</span>
            ) : (
              devices.map((device) => (
                <div className="settings-card__row" key={device.id}>
                  <div className="settings-card__row-main">
                    <strong>{device.device_name}</strong>
                    <span>
                      {device.is_current ? 'current device' : 'linked device'}
                      {device.revoked_at ? ` • revoked ${formatRelativeTime(device.revoked_at)}` : ''}
                    </span>
                    <span>
                      {device.one_time_prekey_count} active one-time prekey
                      {device.one_time_prekey_count === 1 ? '' : 's'}
                    </span>
                  </div>
                  {!device.is_current && !device.revoked_at ? (
                    <div className="settings-card__row-actions">
                      <button
                        className="danger-action"
                        disabled={loading}
                        onClick={() => void handleRevokeLinkedDevice(device.id)}
                        type="button"
                      >
                        Revoke
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
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
            <button className="secondary-action" disabled={loading} onClick={() => void handleCopyDesktopDiagnostics({ desktopWindowTitle, detailRailVisible, activeChatId, activeChatTitle: activeChat?.title ?? null })} type="button">
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
                : 'Cross-user transport now advances a local per-device ratchet from HKDF-derived session roots, explicit initiator ephemeral bootstrap, ratchet version tags, epoch transitions on re-handshake, and local DH steps when peer ratchet keys change; the full Signal-grade ratchet is still next.'}
            </span>
            <span>
              {activeChat
                ? `${remotePrekeyBundles.length} published prekey ${remotePrekeyBundles.length === 1 ? 'bundle' : 'bundles'} visible for this chat`
                : 'Select a chat to inspect published prekeys'}
            </span>
            <span>
              {activeChat
                ? `${chatSessions.length} cached direct-chat session ${chatSessions.length === 1 ? 'record' : 'records'} ready for this chat • ${chatSessions.filter((session) => session.session_state === 'active' && session.establishment_state === 'established').length} established • ${chatSessions.filter((session) => session.session_state === 'active' && session.establishment_state === 'pending_first_message').length} pending first message • ${chatSessions.filter((session) => session.session_state === 'superseded').length} superseded`
                : 'Select a chat to bootstrap direct-chat sessions'}
            </span>
          </div>
          <div className="device-summary-card__actions">
            <button
              className="secondary-action"
              disabled={loading || !activeChat}
              onClick={handleRekeyActiveChatSessions}
              type="button"
            >
              Rekey Active Sessions
            </button>
          </div>
          <div className="settings-card__list">
            {safetyNumbers.length === 0 ? (
              <span className="settings-card__muted">
                No remote safety numbers available for the current chat.
              </span>
            ) : (
              safetyNumbers.map((entry) => (
                <div className="settings-card__row" key={entry.peerDeviceId}>
                  <div className="settings-card__row-main">
                    <strong>{entry.label}</strong>
                    <span>{entry.fingerprint}</span>
                    <span>
                      {entry.verified
                        ? `verified ${formatRelativeTime(entry.verifiedAt)}`
                        : 'not verified'}
                    </span>
                  </div>
                  <div className="settings-card__row-actions">
                    {!entry.verified ? (
                      <button
                        className="mini-action"
                        disabled={verifyingSafetyDeviceId === entry.peerDeviceId || loading}
                        onClick={() => void handleVerifyPeerSafetyNumber(entry.peerDeviceId)}
                        type="button"
                      >
                        Verify
                      </button>
                    ) : (
                      <span className="settings-card__muted">Verified</span>
                    )}
                  </div>
                </div>
              ))
            )}
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
            {federationInviteToken ? (
              <div className="settings-card__row">
                <div className="settings-card__row-main">
                  <strong>Latest invite token</strong>
                  <span>{federationInviteToken}</span>
                </div>
              </div>
            ) : null}
            {federationPeers.length === 0 ? (
              <span className="settings-card__muted">No federation peers configured yet.</span>
            ) : (
              federationPeers.slice(0, 3).map((peer) => (
                <div className="settings-card__row" key={peer.id}>
                  <div className="settings-card__row-main">
                    <strong>{peer.display_name || peer.domain}</strong>
                    <span>
                      {peer.status} • {peer.trust_state}
                      {peer.last_seen_at ? ` • seen ${formatRelativeTime(peer.last_seen_at)}` : ''}
                    </span>
                  </div>
                  <div className="settings-card__row-actions">
                    <button
                      className="mini-action"
                      disabled={loading}
                      onClick={() => void handleCreateFederationPeerInvite(peer.id)}
                      type="button"
                    >
                      Invite
                    </button>
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
                    <button
                      className="mini-action"
                      disabled={loading}
                      onClick={() => void handleQueueFederationDelivery(peer.id)}
                      type="button"
                    >
                      Queue Relay
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="settings-card__list">
            {federationDeliveries.length === 0 ? (
              <span className="settings-card__muted">No federation deliveries queued yet.</span>
            ) : (
              federationDeliveries.slice(0, 3).map((delivery) => (
                <div className="settings-card__row" key={delivery.id}>
                  <div className="settings-card__row-main">
                    <strong>{delivery.event_type}</strong>
                    <span>
                      {delivery.status} • {delivery.attempt_count} attempt
                      {delivery.attempt_count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="settings-card__row-actions">
                    <span className="settings-card__muted">
                      {formatRelativeTime(delivery.updated_at ?? delivery.inserted_at)}
                    </span>
                    {delivery.status !== 'delivered' ? (
                      <button
                        className="mini-action"
                        disabled={loading}
                        onClick={() => void handleAttemptFederationDelivery(delivery.id)}
                        type="button"
                      >
                        Mark Delivered
                      </button>
                    ) : null}
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
              {activeCall
                ? `${callKeys.length} inbound call key distribution${callKeys.length === 1 ? '' : 's'} cached for this device`
                : 'Call key distributions appear after a call is active'}
            </span>
            <span>
              {membraneClientReady
                ? membraneClientConnected
                  ? 'Native Membrane WebRTC client connected.'
                  : 'Membrane client initialized and waiting for endpoint negotiation.'
                : 'Membrane browser client not initialized yet'}
            </span>
            <span>
              {membraneClientConnected
                ? `Membrane client connected as ${membraneClientEndpointId ?? 'pending'} • ${membraneRemoteEndpointCount} remote endpoint${membraneRemoteEndpointCount === 1 ? '' : 's'} • ${membraneRemoteTrackCount} remote track${membraneRemoteTrackCount === 1 ? '' : 's'}`
                : 'Connect the Membrane client after provisioning the endpoint.'}
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
              Initialize Native WebRTC
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
              onClick={handleRotateCallKeyEpoch}
              type="button"
            >
              Rotate Call Key Epoch
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
            {callKeys.length > 0 ? (
              callKeys.slice(0, 4).map((distribution) => (
                <div className="settings-card__row" key={distribution.id}>
                  <div className="settings-card__row-main">
                    <strong>Epoch {distribution.key_epoch}</strong>
                    <span>
                      {distribution.algorithm} • {distribution.status}
                    </span>
                    <span>
                      {distribution.owner_device_id === storedDevice?.deviceId
                        ? 'owned by this device'
                        : `owner ${distribution.owner_device_id}`}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <span className="settings-card__muted">No call key distributions fetched yet.</span>
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

      {showInviteSheet && storedDevice ? (
        <InviteShareSheet
          sessionToken={storedDevice.sessionToken}
          onClose={() => setShowInviteSheet(false)}
        />
      ) : null}
    </div>
    </ChatContext.Provider>
    </AuthContext.Provider>
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
