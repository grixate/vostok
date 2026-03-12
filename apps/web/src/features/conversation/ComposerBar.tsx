import { useCallback, useRef, useState, useEffect, type FormEvent } from 'react'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { useMessages } from '../../hooks/useMessages.ts'
import type { useMediaCapture } from '../../hooks/useMediaCapture.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import type { ChatSummary } from '../../lib/api.ts'
import {
  AttachIcon,
  PhotoSmallIcon,
  FileSmallIcon,
  SendIcon,
  MicIcon,
  VideoCamIcon,
  CloseIcon,
} from '../../icons/index.tsx'

type ComposerBarProps = {
  messages: ReturnType<typeof useMessages>
  media: ReturnType<typeof useMediaCapture>
  activeChat: ChatSummary | null
  chatList: ReturnType<typeof useChatList>
  onDraftChange?: (text: string) => void
  onMessageSent?: () => void
}

export function ComposerBar({ messages, media, activeChat, chatList, onDraftChange, onMessageSent }: ComposerBarProps) {
  const {
    attachPopoverOpen,
    setAttachPopoverOpen,
    draftInputRef
  } = useUIContext()

  const [videoMode, setVideoMode] = useState(false)
  const [videoDuration, setVideoDuration] = useState(0)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks whether the last pointer-down completed a long-press mode toggle,
  // so the subsequent synthetic click is ignored and doesn't start recording.
  const longPressOccurredRef = useRef(false)
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null)

  // Attach live camera stream to preview element
  useEffect(() => {
    const video = videoPreviewRef.current
    if (!video) return
    if (media.roundVideoRecording && media.roundVideoStreamRef.current) {
      video.srcObject = media.roundVideoStreamRef.current
      void video.play().catch(() => undefined)
    } else {
      video.srcObject = null
    }
  }, [media.roundVideoRecording])

  // Start / stop video duration timer
  useEffect(() => {
    if (media.roundVideoRecording) {
      setVideoDuration(0)
      videoTimerRef.current = setInterval(() => {
        setVideoDuration((d) => d + 1)
      }, 1000)
    } else {
      if (videoTimerRef.current) {
        clearInterval(videoTimerRef.current)
        videoTimerRef.current = null
      }
      setVideoDuration(0)
    }
    return () => {
      if (videoTimerRef.current) {
        clearInterval(videoTimerRef.current)
        videoTimerRef.current = null
      }
    }
  }, [media.roundVideoRecording])

  // Reset video mode when round video recording ends
  useEffect(() => {
    if (!media.roundVideoRecording) {
      setVideoMode(false)
    }
  }, [media.roundVideoRecording])

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await messages.sendDraftMessage(chatList.activeChatId)
    // Reset textarea height after send
    if (draftInputRef.current) {
      draftInputRef.current.style.height = 'auto'
    }
    onMessageSent?.()
  }

  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const target = e.target
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, 160)}px`
  }, [])

  // Long-press (400 ms) toggles between mic and camera mode.
  // Sets longPressOccurredRef so the subsequent synthetic click is ignored.
  function handleMediaButtonPointerDown() {
    longPressTimerRef.current = setTimeout(() => {
      longPressOccurredRef.current = true
      setVideoMode((v) => !v)
      longPressTimerRef.current = null
    }, 400)
  }

  function handleMediaButtonPointerUp() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  // Right-click immediately toggles mode (no recording started).
  function handleMediaButtonContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    longPressOccurredRef.current = true // suppress the click that follows contextmenu
    setVideoMode((v) => !v)
  }

  function handleMediaButtonClick() {
    // If a long-press or right-click just toggled the mode, skip recording for
    // this event — the user wanted a mode switch, not to start/stop.
    if (longPressOccurredRef.current) {
      longPressOccurredRef.current = false
      return
    }
    if (videoMode) {
      void media.handleRoundVideoToggle()
    } else {
      void media.handleVoiceNoteToggle()
    }
  }

  if (!activeChat) {
    return null
  }

  // ─── Round video recording UI ──────────────────────────────────────────────
  if (media.roundVideoRecording) {
    return (
      <div className="voice-recorder voice-recorder--video">
        <div className="round-video-composer-preview">
          <video
            ref={videoPreviewRef}
            className="round-video-composer-preview__video"
            muted
            playsInline
          />
          <div className="round-video-composer-preview__ring" />
        </div>
        <div className="voice-recorder__indicator voice-recorder__indicator--video" />
        <span className="voice-recorder__duration">
          {String(Math.floor(videoDuration / 60)).padStart(2, '0')}:{String(videoDuration % 60).padStart(2, '0')}
        </span>
        <button
          className="voice-recorder__cancel"
          type="button"
          onClick={() => { void media.handleRoundVideoToggle() }}
        >
          Cancel
        </button>
        <button
          className="voice-recorder__send"
          type="button"
          aria-label="Stop and send video"
          onClick={() => void media.handleRoundVideoToggle()}
        >
          <SendIcon stroke="white" />
        </button>
      </div>
    )
  }

  // ─── Voice note recording UI ───────────────────────────────────────────────
  if (media.voiceNoteRecording) {
    return (
      <div className="voice-recorder">
        <div className="voice-recorder__indicator" />
        <span className="voice-recorder__duration">
          {String(Math.floor(media.voiceRecordingDuration / 60)).padStart(2, '0')}:{String(media.voiceRecordingDuration % 60).padStart(2, '0')}
        </span>
        <div className="voice-recorder__waves">
          {Array.from({ length: 24 }).map((_, i) => (
            <span key={i} className="voice-recorder__wave-bar" style={{ animationDelay: `${i * 0.05}s` }} />
          ))}
        </div>
        <button className="voice-recorder__cancel" type="button" onClick={() => { media.voiceNoteRecorderRef.current?.stop(); media.cleanupVoiceNoteCapture(); if (media.voiceRecordingTimerRef.current) { clearInterval(media.voiceRecordingTimerRef.current); media.voiceRecordingTimerRef.current = null } media.setVoiceRecordingDuration(0) }}>
          Cancel
        </button>
        <button className="voice-recorder__send" type="button" aria-label="Send voice note" onClick={() => void media.handleVoiceNoteToggle()}>
          <SendIcon stroke="white" />
        </button>
      </div>
    )
  }

  // ─── Normal composer ───────────────────────────────────────────────────────
  return (
    <form className="live-composer" onSubmit={handleSendMessage}>
      <input hidden onChange={media.handleAttachmentPick} ref={media.fileInputRef} type="file" />
      <div className="dropdown-anchor">
        <Tooltip text="Attach file">
          <button className="live-composer__btn" type="button" aria-label="Attach file" onClick={() => setAttachPopoverOpen((v) => !v)}>
            <AttachIcon width={22} height={22} />
          </button>
        </Tooltip>
        {attachPopoverOpen ? (
          <div className="dropdown-menu dropdown-menu--bottom" onClick={() => setAttachPopoverOpen(false)}>
            <button className="dropdown-menu__item" type="button" onClick={() => { media.fileInputRef.current?.setAttribute('accept', 'image/*,video/*'); media.fileInputRef.current?.click() }}>
              <PhotoSmallIcon />
              Photo or Video
            </button>
            <button className="dropdown-menu__item" type="button" onClick={() => { media.fileInputRef.current?.removeAttribute('accept'); media.fileInputRef.current?.click() }}>
              <FileSmallIcon />
              File
            </button>
          </div>
        ) : null}
      </div>
      <div className="live-composer__field">
        {messages.replyTargetMessageId ? (
          <div className="live-composer__reply">
            <div className="live-composer__reply-copy">
              <strong style={{ fontSize: 12, color: 'var(--accent)' }}>{messages.editingMessageId ? 'Editing' : 'Reply'}</strong>
              <span>{messages.replyTargetMessage ? messages.replyTargetMessage.text : 'Earlier message'}</span>
            </div>
            <button className="live-composer__btn live-composer__reply-clear" type="button" onClick={() => messages.setReplyTargetMessageId(null)} aria-label="Cancel reply">
              <CloseIcon width={14} height={14} />
            </button>
          </div>
        ) : null}
        {messages.editingMessageId && !messages.replyTargetMessageId ? (
          <div className="live-composer__reply">
            <div className="live-composer__reply-copy">
              <strong style={{ fontSize: 12, color: 'var(--accent)' }}>Editing</strong>
              <span>{messages.editingTargetMessage ? messages.editingTargetMessage.text : 'Outgoing message'}</span>
            </div>
            <button className="live-composer__btn live-composer__reply-clear" type="button" onClick={() => { messages.setEditingMessageId(null); messages.setDraft('') }} aria-label="Cancel edit">
              <CloseIcon width={14} height={14} />
            </button>
          </div>
        ) : null}
        <textarea
          className="live-composer__input"
          onChange={(event) => { messages.setDraft(event.target.value); onDraftChange?.(event.target.value); handleTextareaInput(event) }}
          placeholder={messages.editingMessageId ? 'Edit message\u2026' : 'Message'}
          ref={draftInputRef}
          rows={1}
          value={messages.draft}
        />
      </div>
      {messages.draft.trim().length > 0 ? (
        <Tooltip text="Send message">
          <button className="live-composer__send" type="submit" aria-label="Send">
            <SendIcon stroke="white" />
          </button>
        </Tooltip>
      ) : (
        <Tooltip text={videoMode ? 'Record video message (right-click to switch to voice)' : 'Record voice message (right-click to switch to video)'}>
          <button
            className={`live-composer__btn live-composer__mic${videoMode ? ' live-composer__mic--video' : ''}`}
            type="button"
            aria-label={videoMode ? 'Record video message' : 'Record voice message'}
            onClick={handleMediaButtonClick}
            onPointerDown={handleMediaButtonPointerDown}
            onPointerUp={handleMediaButtonPointerUp}
            onPointerLeave={handleMediaButtonPointerUp}
            onContextMenu={handleMediaButtonContextMenu}
          >
            {videoMode ? <VideoCamIcon width={22} height={22} /> : <MicIcon width={22} height={22} />}
          </button>
        </Tooltip>
      )}
    </form>
  )
}
