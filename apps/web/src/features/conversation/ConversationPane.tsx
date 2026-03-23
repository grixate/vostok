import { useState, useCallback, useEffect, useRef } from 'react'
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
import { IncomingCallBanner } from '../calls/IncomingCallBanner.tsx'
import { CallPiPBar } from '../calls/CallPiPBar.tsx'
import { CallEndedScreen } from '../calls/CallEndedScreen.tsx'
import { useCallTimer } from '../../hooks/useCallTimer.ts'
import type { useGroupChat } from '../../hooks/useGroupChat.ts'
import type { useCall } from '../../hooks/useCall.ts'
import type { useViewportLayout } from '../../hooks/useViewportLayout.ts'
import type { useMessages } from '../../hooks/useMessages.ts'
import type { useMediaCapture } from '../../hooks/useMediaCapture.ts'
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
  layout: ReturnType<typeof useViewportLayout>
  messages: ReturnType<typeof useMessages>
  media: ReturnType<typeof useMediaCapture>
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
  layout,
  messages,
  media,
  chatList,
  drafts,
  typingIndicator,
  presence,
  appSettings,
  initialSelectedMessageId,
  onBack
}: ConversationPaneProps) {
  const { storedDevice } = useAppContext()
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

  // Determine if we initiated the call (outgoing) or are receiving it (incoming)
  const localDeviceId = storedDevice?.deviceId ?? null
  const isOutgoingCall = !!(call.activeCall && localDeviceId && call.activeCall.started_by_device_id === localDeviceId)
  const isIncomingCall = !!(call.activeCall && call.activeCall.status === 'ringing' && !isOutgoingCall)

  // Track call lifecycle
  useEffect(() => {
    const prev = previousCallRef.current
    const curr = call.activeCall

    if (!prev && curr) {
      // New call appeared
      if (curr.status === 'ringing') {
        setCallUiMode('full')
        setCallMuted(false)
        setCallCameraOn(curr.mode === 'video')
        setCallScreenSharing(false)
        setCallEnded(null)
      } else if (curr.status === 'active') {
        setCallUiMode('full')
        setCallMuted(false)
        setCallCameraOn(curr.mode === 'video')
        setCallScreenSharing(false)
        setCallEnded(null)
      }
    } else if (prev && prev.status === 'ringing' && curr && curr.status === 'active') {
      // Call was accepted — transition from ringing to active
      setCallUiMode('full')
    } else if (prev && (prev.status === 'active' || prev.status === 'ringing') && (!curr || curr.status === 'ended')) {
      // Call ended or declined
      if (prev.status === 'active') {
        setCallEnded({ reason: 'normal', duration: callDuration })
      }
      setCallUiMode('hidden')
    } else if (!curr) {
      setCallUiMode('hidden')
    }

    previousCallRef.current = curr
  }, [call.activeCall])

  // Auto-dismiss call ended screen
  useEffect(() => {
    if (callEnded) {
      const timer = setTimeout(() => setCallEnded(null), 2500)
      return () => clearTimeout(timer)
    }
  }, [callEnded])

  // Reset call UI state when switching chats
  useEffect(() => {
    setCallUiMode('hidden')
    setCallMuted(false)
    setCallCameraOn(false)
    setCallScreenSharing(false)
    setCallEnded(null)
  }, [activeChat?.id])
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
    if (media.roundVideoRecording) {
      setVideoRecordingSeconds(0)
      videoTimerRef.current = setInterval(() => setVideoRecordingSeconds((s) => s + 1), 1000)
    } else {
      if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null }
      setVideoRecordingSeconds(0)
    }
    return () => { if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null } }
  }, [media.roundVideoRecording])

  // Attach live camera stream to the overlay preview element
  useEffect(() => {
    const video = videoOverlayRef.current
    if (!video) return
    if (media.roundVideoRecording && media.roundVideoStreamRef.current) {
      video.srcObject = media.roundVideoStreamRef.current
      void video.play().catch(() => undefined)
    } else {
      video.srcObject = null
    }
  }, [media.roundVideoRecording])

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
    if (!activeChat) return
    messages.setDraft('👋')
    void messages.sendDraftMessage(chatList.activeChatId)
  }, [activeChat, messages, chatList.activeChatId])

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
    if (files.length > 0 && media.fileInputRef.current) {
      // Create a synthetic change event by assigning files
      const dt = new DataTransfer()
      for (let i = 0; i < files.length; i++) {
        dt.items.add(files[i])
      }
      media.fileInputRef.current.files = dt.files
      media.fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, [media.fileInputRef])

  if (!activeChat) {
    return (
      <main className="conversation-pane">
        <div className="conversation-empty-state">
          <MessageSquare size={48} color="#555555" strokeWidth={1.25} />
          <span className="conversation-empty-state__text">Choose a chat to start messaging</span>
        </div>
      </main>
    )
  }

  if (profileOpen) {
    return (
      <main className="conversation-pane">
        <ChatProfilePane
          activeChat={activeChat}
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
          contactName={activeChat.title}
          contactInitial={activeChat.title.slice(0, 1)}
          endReason={callEnded.reason}
          duration={callEnded.duration}
        />
      </main>
    )
  }

  // ─── Incoming call — receiver sees accept/decline ────────────────────
  if (callUiMode === 'full' && isIncomingCall && call.activeCall) {
    return (
      <main className="conversation-pane">
        <div className="outgoing-call-screen">
          <div className="outgoing-call-screen__body">
            <div className="outgoing-call-screen__avatar">
              {activeChat.title.slice(0, 1)}
            </div>
            <span className="outgoing-call-screen__name">{activeChat.title}</span>
            <span className="outgoing-call-screen__status">
              Incoming {call.activeCall.mode} call…
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
  if (callUiMode === 'full' && call.activeCall?.status === 'ringing') {
    return (
      <main className="conversation-pane">
        <OutgoingCallScreen
          contactName={activeChat.title}
          contactInitial={activeChat.title.slice(0, 1)}
          status="Calling…"
          muted={callMuted}
          onToggleMute={() => setCallMuted((m) => !m)}
          onHangup={call.handleEndCall}
        />
      </main>
    )
  }

  // ─── Full call screen (replaces chat content) ──────────────────────────
  if (callUiMode === 'full' && call.activeCall?.status === 'active') {
    return (
      <main className="conversation-pane">
        <ActiveCallScreen
          contactName={activeChat.title}
          contactInitial={activeChat.title.slice(0, 1)}
          mode={call.activeCall.mode === 'video' ? 'video' : 'voice'}
          remoteStream={null}
          localStream={null}
          remoteCameraOn={false}
          muted={callMuted}
          cameraOn={callCameraOn}
          screenSharing={callScreenSharing}
          encrypted={false}
          onBack={() => setCallUiMode('pip')}
          onToggleMute={() => setCallMuted((m) => !m)}
          onToggleCamera={() => setCallCameraOn((c) => !c)}
          onToggleScreen={() => setCallScreenSharing((s) => !s)}
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
      <ConversationHeader
        activeChat={activeChat}
        groupChat={groupChat}
        call={call}
        layout={layout}
        typingUsers={typingIndicator.typingUsers}
        presence={presence}
        onClickTitle={handleClickTitle}
        onBack={onBack}
      />
      {/* PiP call bar — shown when call is active/ringing but minimized */}
      {callUiMode === 'pip' && call.activeCall && (call.activeCall.status === 'active' || call.activeCall.status === 'ringing') && (
        <CallPiPBar
          contactName={activeChat.title}
          duration={call.activeCall.status === 'ringing' ? 'Calling…' : callDuration}
          muted={callMuted}
          cameraOn={callCameraOn}
          onToggleMute={() => setCallMuted((m) => !m)}
          onToggleCamera={call.activeCall.mode === 'video' ? () => setCallCameraOn((c) => !c) : undefined}
          onHangup={call.handleEndCall}
          onExpand={() => setCallUiMode('full')}
        />
      )}
      <ChatSearchBar
        messageItems={messages.messageItems}
        onSearchHighlightChange={handleSearchHighlightChange}
      />
      <MessageThread
        messages={messages}
        media={media}
        activeChat={activeChat}
        searchHighlight={searchHighlight}
        initialSelectedMessageId={initialSelectedMessageId}
        onOpenMedia={handleOpenMediaViewer}
        onSayHello={handleSayHello}
      />
      {media.roundVideoRecording ? (
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
      <ComposerBar
        messages={messages}
        media={media}
        activeChat={activeChat}
        chatList={chatList}
        sendKey={appSettings.settings.general_send_key}
        onDraftChange={(text) => { drafts.handleDraftChange(text); if (text.length > 0 && appSettings.settings.privacy_typing_indicators) typingIndicator.sendTypingEvent() }}
        onMessageSent={drafts.handleMessageSent}
      />
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
