/* eslint-disable react-hooks/refs */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { PhoneIcon, PhoneOffIcon } from '../../icons/index.tsx'
import { MessageSquare } from 'lucide-react'
import { ConversationHeader } from './ConversationHeader.tsx'
import { ChatSearchBar } from './ChatSearchBar.tsx'
import { MessageThread } from './MessageThread.tsx'
import { ComposerBar } from './ComposerBar.tsx'
import { ChatProfilePane } from './ChatProfilePane.tsx'
import { MediaViewer } from '../overlays/MediaViewer.tsx'
import { ActiveCallScreen } from '../calls/ActiveCallScreen.tsx'
import { OutgoingCallScreen } from '../calls/OutgoingCallScreen.tsx'
import { CallPiPBar } from '../calls/CallPiPBar.tsx'
import { CallEndedScreen } from '../calls/CallEndedScreen.tsx'
import {
  playRingtone,
  stopRingtone,
  playRingback,
  stopRingback,
  playConnectSound,
  playDisconnectSound,
  cleanupAudio
} from '../calls/callSounds.ts'
import { useCallTimer } from '../../hooks/useCallTimer.ts'
import { buildDirectCallStatusLabel } from '../../lib/call-runtime.ts'
import { getRawChatId } from '../../lib/multi-server.ts'
import type { useGroupChat } from '../../hooks/useGroupChat.ts'
import type { useCall } from '../../hooks/useCall.ts'
import type { useMessages } from '../../hooks/useMessages.ts'
import type { useMediaCapture } from '../../hooks/useMediaCapture.ts'
import type { useDownloadManager } from '../../hooks/useDownloadManager.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import type { useDrafts } from '../../hooks/useDrafts.ts'
import type { useTypingIndicator } from '../../hooks/useTypingIndicator.ts'
import type { usePresence } from '../../hooks/usePresence.ts'
import type { useSettings } from '../../hooks/useSettings.ts'
import type { ChatSummary } from '../../lib/api.ts'

type ConversationPaneProps = {
  activeChat: ChatSummary | null
  groupChat: ReturnType<typeof useGroupChat>
  call: ReturnType<typeof useCall>
  messages: ReturnType<typeof useMessages>
  media: ReturnType<typeof useMediaCapture>
  downloadManager: ReturnType<typeof useDownloadManager>
  chatList: ReturnType<typeof useChatList>
  drafts: ReturnType<typeof useDrafts>
  typingIndicator: ReturnType<typeof useTypingIndicator>
  presence: ReturnType<typeof usePresence>
  appSettings: ReturnType<typeof useSettings>
  initialSelectedMessageId?: string | null
  onBack?: () => void
}

export function ConversationPane({
  activeChat,
  groupChat,
  call,
  messages,
  media,
  downloadManager,
  chatList,
  drafts,
  typingIndicator,
  presence,
  appSettings,
  initialSelectedMessageId,
  onBack
}: ConversationPaneProps) {
  const { storedDevice } = useAppContext()
  const selectedChat = chatList.activeChatId
    ? chatList.chatItems.find((chat) => chat.id === chatList.activeChatId) ?? activeChat
    : activeChat
  const [searchHighlight, setSearchHighlight] = useState<{ query: string; activeMessageId?: string } | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [callUiMode, setCallUiMode] = useState<'full' | 'pip' | 'hidden'>('hidden')
  const [callMuted, setCallMuted] = useState(false)
  const [callCameraOn, setCallCameraOn] = useState(false)
  const [callScreenSharing, setCallScreenSharing] = useState(false)
  const [callEnded, setCallEnded] = useState<{ reason: string; duration: string } | null>(null)
  const callDuration = useCallTimer(call.activeCall?.status === 'active')
  const previousCallRef = useRef(call.activeCall)
  const startupSelectedChatIdRef = useRef<string | null>(chatList.activeChatId)
  const previousActiveChatIdRef = useRef<string | null>(chatList.activeChatId)
  const interruptedChatIdRef = useRef<string | null>(null)
  const interruptedCallIdRef = useRef<string | null>(null)
  const releaseLocalMedia = call._handleReleaseLocalMedia
  const endCall = call.handleEndCall
  const attachLocalMedia = call._handleAttachLocalMedia
  const roundVideoStreamRef = media.roundVideoStreamRef
  const fileInputRef = media.fileInputRef
  const roundVideoRecording = media.roundVideoRecording

  // Determine if we initiated the call (outgoing) or are receiving it (incoming)
  const localDeviceId = storedDevice?.deviceId ?? null
  const isOutgoingCall = !!(call.activeCall && localDeviceId && call.activeCall.started_by_device_id === localDeviceId)
  const isIncomingCall = !!(call.activeCall && call.activeCall.status === 'ringing' && !isOutgoingCall)

  const rememberInterruptedChat = useCallback((callId: string, chatId: string | null) => {
    if (!chatId) {
      return
    }

    interruptedChatIdRef.current = chatId
    interruptedCallIdRef.current = callId
  }, [])

  const clearInterruptedChat = useCallback(() => {
    interruptedChatIdRef.current = null
    interruptedCallIdRef.current = null
  }, [])

  const restoreInterruptedChat = useCallback(() => {
    const interruptedChatId = interruptedChatIdRef.current
    if (!interruptedChatId) {
      return
    }

    interruptedChatIdRef.current = null
    interruptedCallIdRef.current = null

    if (!chatList.chatItems.some((chat) => chat.id === interruptedChatId)) {
      return
    }

    if (chatList.activeChatId !== interruptedChatId) {
      chatList.setActiveChatId(interruptedChatId)
    }
  }, [chatList])

  const handleExpandCall = useCallback(() => {
    if (call.activeCall?.scope_type === 'chat' && call.activeCallChatId && chatList.activeChatId !== call.activeCallChatId) {
      rememberInterruptedChat(call.activeCall.id, chatList.activeChatId)
      chatList.setActiveChatId(call.activeCallChatId)
    }
    setCallUiMode('full')
  }, [call.activeCall, call.activeCallChatId, chatList, rememberInterruptedChat])

  const handlePiPHangup = useCallback(() => {
    void call.handleEndCall()
  }, [call])

  // Track call lifecycle
  useEffect(() => {
    const prev = previousCallRef.current
    const curr = call.activeCall
    const isVideoCall = curr?.mode === 'video' || curr?.media_mode === 'video'
    const prevId = prev?.id ?? null
    const currId = curr?.id ?? null
    const hasNewCall = prevId !== currId && curr != null
    const statusChanged = prev?.status !== curr?.status

    if (hasNewCall) {
      if (curr.status === 'ringing' || curr.status === 'active') {
        setCallUiMode('full')
        setCallMuted(false)
        setCallCameraOn(isVideoCall)
        setCallScreenSharing(false)
        setCallEnded(null)
      }
    } else if (statusChanged && prev?.status === 'ringing' && curr?.status === 'active') {
      setCallUiMode('full')
    } else if (statusChanged && prev && (prev.status === 'active' || prev.status === 'ringing') && (!curr || curr.status === 'ended')) {
      if (prev.status === 'active') {
        setCallEnded({ reason: 'normal', duration: callDuration })
      }
      releaseLocalMedia()
      setCallUiMode('hidden')
      restoreInterruptedChat()
    } else if (curr == null && callUiMode !== 'hidden') {
      setCallUiMode('hidden')
      restoreInterruptedChat()
    } else if (
      curr != null &&
      callUiMode === 'hidden' &&
      (curr.status === 'ringing' || curr.status === 'active')
    ) {
      // Recover a surviving call after chat/view restoration without re-triggering on every render.
      setCallUiMode('full')
      setCallMuted(false)
      setCallCameraOn(isVideoCall)
      setCallScreenSharing(false)
      setCallEnded(null)
    }

    previousCallRef.current = curr
  }, [call.activeCall, callDuration, callUiMode, releaseLocalMedia, restoreInterruptedChat])

  useEffect(() => {
    if (!call.activeCall) {
      clearInterruptedChat()
      return
    }

    if (callUiMode !== 'full') {
      return
    }

    const currentChatId = chatList.activeChatId

    if (!currentChatId) {
      return
    }

    let interruptedChatId = currentChatId

    const startupSelectedChatId = startupSelectedChatIdRef.current
    const recoveringInitialRestoredCall = previousCallRef.current == null

    if (
      recoveringInitialRestoredCall &&
      startupSelectedChatId &&
      startupSelectedChatId !== currentChatId
    ) {
      interruptedChatId = startupSelectedChatId
    } else if (call.activeCall.scope_type === 'chat' && call.activeCallChatId && currentChatId === call.activeCallChatId) {
      const startupSelectedChatId = startupSelectedChatIdRef.current

      if (startupSelectedChatId && startupSelectedChatId !== call.activeCallChatId) {
        interruptedChatId = startupSelectedChatId
      } else {
        return
      }
    }

    if (
      interruptedCallIdRef.current === call.activeCall.id &&
      interruptedChatIdRef.current === interruptedChatId
    ) {
      return
    }

    rememberInterruptedChat(call.activeCall.id, interruptedChatId)
  }, [call.activeCall, call.activeCallChatId, callUiMode, chatList.activeChatId, clearInterruptedChat, rememberInterruptedChat])

  // Reset call UI state when switching chats
  useEffect(() => {
    const nextActiveChatId = chatList.activeChatId
    const previousActiveChatId = previousActiveChatIdRef.current

    if (previousActiveChatId === nextActiveChatId) {
      return
    }

    previousActiveChatIdRef.current = nextActiveChatId

    const currentCall = call.activeCall
    const callIsVisible = currentCall && (currentCall.status === 'ringing' || currentCall.status === 'active')
    const rawNextActiveChatId = getRawChatId(nextActiveChatId)
    const isInitialChatHydration = previousActiveChatId === null && nextActiveChatId !== null

    if (callIsVisible) {
      if (isInitialChatHydration) {
        return
      }

      const isIncomingVisibleCall =
        currentCall.status === 'ringing' &&
        Boolean(localDeviceId) &&
        currentCall.started_by_device_id !== localDeviceId
      const callBelongsToVisibleChat =
        currentCall.scope_type === 'chat' && (
          (call.activeCallChatId !== null && call.activeCallChatId === nextActiveChatId) ||
          (rawNextActiveChatId !== null && currentCall.chat_id === rawNextActiveChatId)
        )

      if (!callBelongsToVisibleChat) {
        setCallUiMode(isIncomingVisibleCall ? 'full' : 'pip')
        if (!isIncomingVisibleCall) {
          clearInterruptedChat()
        }
      }
      return
    }

    clearInterruptedChat()
    setCallUiMode('hidden')
    setCallMuted(false)
    setCallCameraOn(false)
    setCallScreenSharing(false)
    setCallEnded(null)
  }, [call.activeCall, call.activeCallChatId, chatList.activeChatId, clearInterruptedChat, localDeviceId])

  // ── Call sounds ──────────────────────────────────────────────────────
  useEffect(() => {
    const status = call.activeCall?.status

    if (status === 'ringing' && isOutgoingCall) {
      playRingback()
      return () => { stopRingback() }
    }
    if (status === 'ringing' && isIncomingCall) {
      playRingtone()
      return () => { stopRingtone() }
    }
    if (status === 'active') {
      // Stop any ringing sounds and play connect chime
      stopRingback()
      stopRingtone()
      playConnectSound()
    }

    return undefined
  }, [call.activeCall?.status, isOutgoingCall, isIncomingCall])

  // Play disconnect sound when call ends
  useEffect(() => {
    if (callEnded) {
      playDisconnectSound()
      return () => { cleanupAudio() }
    }
    return undefined
  }, [callEnded])

  // ── Outgoing call ringing timeout (35s — server times out at 30s) ──
  useEffect(() => {
    if (call.activeCall?.status === 'ringing' && isOutgoingCall) {
      const timer = setTimeout(() => {
        endCall()
      }, 35_000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [call.activeCall?.status, endCall, isOutgoingCall])

  // Auto-attach local media when call becomes active
  useEffect(() => {
    if (call.activeCall?.status === 'active' && !call.localMediaStreamRef.current) {
      const mode = call.activeCall.mode === 'video' || call.activeCall.media_mode === 'video' ? 'audio_video' : 'audio'
      attachLocalMedia(mode)
    }
  }, [attachLocalMedia, call.activeCall?.media_mode, call.activeCall?.mode, call.activeCall?.status, call.localMediaStreamRef])

  // Build remote stream from Membrane remote tracks
  const remoteStream = useMemo(() => {
    const readyTracks = call.membraneRemoteTracks
      .filter(t => t.ready && t.mediaTrack)
      .map(t => t.mediaTrack!)
    if (readyTracks.length === 0) return null
    return new MediaStream(readyTracks)
  }, [call.membraneRemoteTracks])

  const remoteCameraOn = call.membraneRemoteTracks.some(
    t => t.ready && t.kind === 'video' && t.mediaTrack
  )

  // Real media toggle handlers
  const handleToggleMute = useCallback(() => {
    setCallMuted(prev => {
      const next = !prev
      const stream = call.localMediaStreamRef.current
      if (stream) {
        for (const track of stream.getAudioTracks()) {
          track.enabled = !next
        }
      }
      return next
    })
  }, [call.localMediaStreamRef])

  const handleToggleCamera = useCallback(() => {
    setCallCameraOn(prev => {
      const next = !prev
      const stream = call.localMediaStreamRef.current
      if (stream) {
        for (const track of stream.getVideoTracks()) {
          track.enabled = next
        }
      }
      return next
    })
  }, [call.localMediaStreamRef])

  // Screen sharing toggle
  const screenShareStreamRef = useRef<MediaStream | null>(null)

  const handleToggleScreen = useCallback(async () => {
    if (callScreenSharing) {
      // Stop screen sharing
      if (screenShareStreamRef.current) {
        for (const track of screenShareStreamRef.current.getTracks()) {
          track.stop()
        }
        screenShareStreamRef.current = null
      }
      setCallScreenSharing(false)
    } else {
      // Start screen sharing
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        })
        screenShareStreamRef.current = displayStream

        // Listen for user stopping share via browser UI
        displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
          screenShareStreamRef.current = null
          setCallScreenSharing(false)
        })

        setCallScreenSharing(true)
      } catch {
        // User cancelled the screen share picker — not an error
      }
    }
  }, [callScreenSharing])

  // Auto-dismiss call ended screen
  useEffect(() => {
    if (callEnded) {
      const timer = setTimeout(() => setCallEnded(null), 2500)
      return () => clearTimeout(timer)
    }
  }, [callEnded])

  const [mediaViewer, setMediaViewer] = useState<{
    items: Array<{ url: string; type: 'image' | 'video'; senderName: string; timestamp: string; fileName: string }>
    initialIndex: number
  } | null>(null)

  const handleOpenMediaViewer = useCallback((url: string, type: 'image' | 'video', senderName: string, timestamp: string, fileName: string) => {
    // Collect all media from messages for prev/next navigation
    const allMedia: Array<{ url: string; type: 'image' | 'video'; senderName: string; timestamp: string; fileName: string }> = []
    let openIndex = 0

    for (const msg of messages.messageItems) {
      if (msg.attachment?.thumbnailDataUrl && !msg.attachment.fileName.startsWith('voice-note-')) {
        const isVideo = msg.attachment.contentType?.startsWith('video/') ?? false
        const itemUrl = msg.attachment.thumbnailDataUrl
        allMedia.push({
          url: itemUrl,
          type: isVideo ? 'video' : 'image',
          senderName: msg.senderUsername ?? '',
          timestamp: msg.sentAt ?? '',
          fileName: msg.attachment.fileName
        })
        if (itemUrl === url) {
          openIndex = allMedia.length - 1
        }
      }
    }

    if (allMedia.length === 0) {
      allMedia.push({ url, type, senderName, timestamp, fileName })
    }

    setMediaViewer({ items: allMedia, initialIndex: openIndex })
  }, [messages.messageItems])
  const [videoRecordingSeconds, setVideoRecordingSeconds] = useState(0)
  const videoOverlayRef = useRef<HTMLVideoElement | null>(null)
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Video recording timer
  useEffect(() => {
    if (roundVideoRecording) {
      setVideoRecordingSeconds(0)
      videoTimerRef.current = setInterval(() => setVideoRecordingSeconds((s) => s + 1), 1000)
    } else {
      if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null }
      setVideoRecordingSeconds(0)
    }
    return () => { if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null } }
  }, [roundVideoRecording])

  // Attach live camera stream to the overlay preview element
  useEffect(() => {
    const video = videoOverlayRef.current
    if (!video) return
    if (roundVideoRecording && roundVideoStreamRef.current) {
      video.srcObject = roundVideoStreamRef.current
      void video.play().catch(() => undefined)
    } else {
      video.srcObject = null
    }
  }, [roundVideoRecording, roundVideoStreamRef])

  const handleSearchHighlightChange = useCallback((highlight: { query: string; activeMessageId?: string } | null) => {
    setSearchHighlight(highlight)
  }, [])

  const handleClickTitle = useCallback(() => {
    setProfileOpen(true)
  }, [])

  const handleCloseProfile = useCallback(() => {
    setProfileOpen(false)
  }, [])

  const handleSayHello = useCallback(() => {
    if (!selectedChat) return
    messages.setDraft('👋')
    void messages.sendDraftMessage(chatList.activeChatId)
  }, [selectedChat, messages, chatList.activeChatId])

  // ─── Drag-and-drop file upload ─────────────────────────────────────────────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      setDragOver(true)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only clear if actually leaving the pane (not entering a child)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
      setDragOver(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const files = e.dataTransfer.files
    const fileInput = fileInputRef.current
    if (files.length > 0 && fileInput) {
      // Create a synthetic change event by assigning files
      const dt = new DataTransfer()
      for (let i = 0; i < files.length; i++) {
        dt.items.add(files[i])
      }
      fileInput.files = dt.files
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, [fileInputRef])

  const activeCallChatSummary = call.activeCallChatId
    ? chatList.chatItems.find((chat) => chat.id === call.activeCallChatId) ?? null
    : null
  const resolvedChat = selectedChat ?? activeCallChatSummary
  const activeCallTitle = call.activeCallDisplayTitle
    ?? (activeCallChatSummary
      ? chatList.hasMultipleServers && activeCallChatSummary.serverLabel
        ? `${activeCallChatSummary.title} · ${activeCallChatSummary.serverLabel}`
        : activeCallChatSummary.title
      : selectedChat?.title
        ?? call.activeCallRoom?.title
        ?? 'Call')
  const activeCallInitial = activeCallTitle.slice(0, 1).toUpperCase()
  const activeGroupParticipants = call.callParticipants
    .map((participant) => {
      const label = participant.display_name || participant.username || participant.user_id
      return {
        id: participant.device_id,
        name: label,
        initial: label.slice(0, 1).toUpperCase(),
        muted: participant.track_kind === 'video' ? false : false
      }
    })
    .filter((participant, index, list) => {
      return list.findIndex((candidate) => candidate.id === participant.id) === index
    })

  if (!resolvedChat && !(call.activeCall && call.activeCall.scope_type === 'call_room')) {
    return (
      <main className="conversation-pane">
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="empty-state__icon">
            <MessageSquare size={28} strokeWidth={1.5} />
          </div>
          <p className="empty-state__title">Select a conversation</p>
          <p className="empty-state__body">Choose a chat from the sidebar to start messaging, or create a new one.</p>
        </div>
      </main>
    )
  }

  const activeServerLabel =
    resolvedChat && 'serverLabel' in resolvedChat && typeof resolvedChat.serverLabel === 'string'
      ? resolvedChat.serverLabel
      : null
  const activeServerUrl =
    resolvedChat && 'serverUrl' in resolvedChat && typeof resolvedChat.serverUrl === 'string'
      ? resolvedChat.serverUrl
      : null
  const showServerLabel = chatList.hasMultipleServers && Boolean(activeServerLabel)
  const currentChatUserId = resolvedChat
    ? chatList.resolveServerScope(resolvedChat.id)?.server.auth?.user.id ?? null
    : null
  const activeCallDisplayTitle = activeCallTitle
  const directCallStatusLabel = buildDirectCallStatusLabel(
    call.directCallStatus,
    call.directCallMode,
    call.transportError
  )
  const capabilityStatusLabel =
    call.callCapabilityState === 'supported'
      ? null
      : (call.callCapabilityReason ?? 'Calls are unavailable on this browser.')
  const mediaEncryptionLabel =
    call.mediaEncryptionState === 'verified'
      ? `Verified media encryption${call.currentKeyEpoch ? ` · epoch ${call.currentKeyEpoch}` : ''}`
      : call.mediaEncryptionState === 'encrypted'
        ? `Encrypted media${call.currentKeyEpoch ? ` · epoch ${call.currentKeyEpoch}` : ''}`
        : call.mediaEncryptionState === 'negotiating'
          ? 'Negotiating media encryption…'
          : call.mediaEncryptionState === 'error'
            ? 'Media encryption unavailable'
            : undefined
  const activeScreenStatusLabel = call.directCallStatus === 'active'
    ? mediaEncryptionLabel
    : (capabilityStatusLabel ?? directCallStatusLabel)

  if (profileOpen && resolvedChat) {
    return (
      <main className="conversation-pane">
        <ChatProfilePane
          activeChat={resolvedChat}
          groupChat={groupChat}
          onClose={handleCloseProfile}
        />
      </main>
    )
  }

  // ─── Call ended screen (brief 2.5s summary) ────────────────────────────
  if (callEnded) {
    return (
      <main className="conversation-pane">
        <CallEndedScreen
          contactName={activeCallDisplayTitle}
          contactInitial={activeCallInitial}
          endReason={callEnded.reason}
          duration={callEnded.duration}
        />
      </main>
    )
  }

  // ─── Incoming call — receiver sees accept/decline ────────────────────
  if (callUiMode === 'full' && isIncomingCall && call.activeCall && call.activeCall.mode !== 'group') {
    return (
      <main className="conversation-pane">
        <div className="outgoing-call-screen">
          <div className="outgoing-call-screen__body">
            <div className="outgoing-call-screen__avatar">
              {resolvedChat ? resolvedChat.title.slice(0, 1) : activeCallInitial}
            </div>
            <span className="outgoing-call-screen__name">{activeCallDisplayTitle}</span>
            <span className="outgoing-call-screen__status">
              {capabilityStatusLabel ?? directCallStatusLabel}
            </span>
          </div>
          <div className="outgoing-call-screen__controls">
            <div className="incoming-call-overlay__actions">
              <button
                type="button"
                className="incoming-call-overlay__action-btn incoming-call-overlay__action-btn--decline"
                onClick={call.handleDeclineCall}
                aria-label="Decline call"
              >
                <PhoneOffIcon width={24} height={24} />
              </button>
              <button
                type="button"
                className="incoming-call-overlay__action-btn incoming-call-overlay__action-btn--accept"
                onClick={call.handleAcceptCall}
                aria-label="Accept call"
                disabled={call.callCapabilityState !== 'supported'}
                title={capabilityStatusLabel ?? 'Accept call'}
              >
                <PhoneIcon width={24} height={24} />
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  // ─── Outgoing ringing screen — caller sees "Calling..." ─────────────
  if (callUiMode === 'full' && call.activeCall?.status === 'ringing' && call.activeCall.mode !== 'group') {
    return (
      <main className="conversation-pane">
        <OutgoingCallScreen
          contactName={activeCallDisplayTitle}
          contactInitial={activeCallInitial}
          status={directCallStatusLabel}
          muted={callMuted}
          onToggleMute={() => setCallMuted((m) => !m)}
          onHangup={call.handleEndCall}
        />
      </main>
    )
  }

  if (callUiMode === 'full' && call.activeCall?.mode === 'group') {
    return (
      <main className="conversation-pane">
        <ActiveCallScreen
          contactName={activeCallDisplayTitle}
          contactInitial={activeCallInitial}
          mode={call.activeCall.media_mode === 'video' ? 'video' : 'voice'}
          remoteStream={remoteStream}
          localStream={call.localMediaStreamRef.current}
          remoteCameraOn={remoteCameraOn}
          muted={callMuted}
          cameraOn={callCameraOn}
          screenSharing={callScreenSharing}
          statusLabel={
            capabilityStatusLabel ??
            (call.activeCall.status === 'ringing' ? 'Group call ringing…' : mediaEncryptionLabel)
          }
          participants={activeGroupParticipants}
          onBack={() => setCallUiMode('pip')}
          onToggleMute={handleToggleMute}
          onToggleCamera={handleToggleCamera}
          onToggleScreen={handleToggleScreen}
          onHangup={call.activeCall.status === 'ringing' && isIncomingCall ? call.handleDeclineCall : call.handleEndCall}
        />
      </main>
    )
  }

  // ─── Full call screen (replaces chat content) ──────────────────────────
  if (
    callUiMode === 'full' &&
    call.activeCall?.status === 'active' &&
    (call.directCallStatus === 'connecting' ||
      call.directCallStatus === 'active' ||
      call.directCallStatus === 'error')
  ) {
    return (
      <main className="conversation-pane">
        <ActiveCallScreen
          contactName={activeCallDisplayTitle}
          contactInitial={activeCallInitial}
          mode={(call.activeCall.mode === 'video' || call.activeCall.media_mode === 'video') ? 'video' : 'voice'}
          remoteStream={remoteStream}
          localStream={call.localMediaStreamRef.current}
          remoteCameraOn={remoteCameraOn}
          muted={callMuted}
          cameraOn={callCameraOn}
          screenSharing={callScreenSharing}
          statusLabel={activeScreenStatusLabel}
          showScreenControls={false}
          participants={call.activeCall.mode === 'group' ? activeGroupParticipants : undefined}
          onBack={() => setCallUiMode('pip')}
          onToggleMute={handleToggleMute}
          onToggleCamera={handleToggleCamera}
          onToggleScreen={handleToggleScreen}
          onHangup={call.handleEndCall}
        />
      </main>
    )
  }

  return (
    <main
      className="conversation-pane"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {resolvedChat ? <ConversationHeader
        activeChat={resolvedChat}
        currentUserId={currentChatUserId}
        serverLabel={showServerLabel ? activeServerLabel : null}
        serverUrl={activeServerUrl}
        groupChat={groupChat}
        call={call}
        typingUsers={typingIndicator.typingUsers}
        presence={presence}
        onClickTitle={handleClickTitle}
        onBack={onBack}
      /> : null}
      {/* PiP call bar — shown when call is active/ringing but minimized */}
      {callUiMode === 'pip' && call.activeCall && (call.activeCall.status === 'active' || call.activeCall.status === 'ringing') && (
        <CallPiPBar
          contactName={activeCallDisplayTitle}
          duration={
            call.activeCall.status === 'ringing'
              ? (capabilityStatusLabel ?? directCallStatusLabel)
              : call.directCallStatus === 'active'
                ? callDuration
                : (capabilityStatusLabel ?? directCallStatusLabel)
          }
          muted={callMuted}
          cameraOn={callCameraOn}
          onToggleMute={() => setCallMuted((m) => !m)}
          onToggleCamera={call.activeCall.mode === 'video' || call.activeCall.media_mode === 'video' ? handleToggleCamera : undefined}
          onHangup={handlePiPHangup}
          onExpand={handleExpandCall}
        />
      )}
      {resolvedChat ? <ChatSearchBar
        messageItems={messages.messageItems}
        onSearchHighlightChange={handleSearchHighlightChange}
      /> : null}
      {resolvedChat ? <MessageThread
        messages={messages}
        media={media}
        downloadManager={downloadManager}
        activeChat={resolvedChat}
        chatType={resolvedChat.type === 'group' ? 'group' : 'direct'}
        searchHighlight={searchHighlight}
        initialSelectedMessageId={initialSelectedMessageId}
        onOpenMedia={handleOpenMediaViewer}
        onSayHello={handleSayHello}
      /> : null}
      {roundVideoRecording ? (
        <div className="video-record-overlay">
          <div className="video-record-overlay__dim" />
          <div className="video-record-overlay__center">
            <div className="video-record-overlay__cam-outer">
              <video
                ref={videoOverlayRef}
                className="video-record-overlay__cam-video"
                muted
                playsInline
              />
              <div className="video-record-overlay__cam-ring" />
              <span className="video-record-overlay__rec-badge">REC</span>
            </div>
            <span className="video-record-overlay__timer">
              {String(Math.floor(videoRecordingSeconds / 60)).padStart(2, '0')}:{String(videoRecordingSeconds % 60).padStart(2, '0')}
            </span>
          </div>
        </div>
      ) : null}
      {resolvedChat ? <ComposerBar
        messages={messages}
        media={media}
        activeChat={resolvedChat}
        chatList={chatList}
        sendKey={appSettings.settings.general_send_key}
        spellCheck={appSettings.settings.general_spelling}
        autoCapitalize={appSettings.settings.general_capitalize}
        onDraftChange={(text) => { drafts.handleDraftChange(text); if (text.length > 0 && appSettings.settings.privacy_typing_indicators) typingIndicator.sendTypingEvent() }}
        onMessageSent={drafts.handleMessageSent}
      /> : null}
      {dragOver ? (
        <div className="drag-drop-overlay">
          <div className="drag-drop-overlay__zone">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M12 4L8 8M12 4L16 8" />
              <path d="M20 21H4" />
              <path d="M20 16V21" />
              <path d="M4 16V21" />
            </svg>
            <span>Drop files to send</span>
          </div>
        </div>
      ) : null}
      {mediaViewer ? (
        <MediaViewer
          items={mediaViewer.items}
          initialIndex={mediaViewer.initialIndex}
          onClose={() => setMediaViewer(null)}
        />
      ) : null}
    </main>
  )
}
