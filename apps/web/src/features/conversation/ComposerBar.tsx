/* eslint-disable react-hooks/refs */
import { useCallback, useRef, useState, useEffect, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { Tooltip } from '../../components/Tooltip.tsx'
import { EmojiPicker } from '../../components/EmojiPicker.tsx'
import type { useMessages } from '../../hooks/useMessages.ts'
import type { useMediaCapture } from '../../hooks/useMediaCapture.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import type { ChatSummary } from '../../lib/api.ts'
import {
  AttachIcon,
  PhotoSmallIcon,
  FileSmallIcon,
  EditSmallIcon,
  SendIcon,
  MicIcon,
  VideoCamIcon,
  CloseIcon,
  SmileIcon,
  DeleteIcon,
  PauseIcon,
} from '../../icons/index.tsx'

const WAVEFORM_BAR_COUNT = 32

function LiveWaveform({ analyserRef }: { analyserRef: React.RefObject<AnalyserNode | null> }) {
  const [levels, setLevels] = useState<number[]>(() => Array(WAVEFORM_BAR_COUNT).fill(0.08))
  const rafRef = useRef<number>(0)

  useEffect(() => {
    let running = true
    const dataArray = new Uint8Array(128)

    function tick() {
      if (!running) return
      const analyser = analyserRef.current
      if (analyser) {
        analyser.getByteFrequencyData(dataArray)
        // Sample WAVEFORM_BAR_COUNT evenly-spaced bins from the frequency data
        const next: number[] = []
        for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
          const idx = Math.floor((i / WAVEFORM_BAR_COUNT) * dataArray.length)
          next.push(Math.max(0.08, dataArray[idx] / 255))
        }
        setLevels(next)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => { running = false; cancelAnimationFrame(rafRef.current) }
  }, [analyserRef])

  return (
    <div className="voice-recorder__waves">
      {levels.map((level, i) => (
        <span
          key={i}
          className="voice-recorder__wave-bar voice-recorder__wave-bar--live"
          style={{ height: `${Math.max(4, Math.round(level * 44))}px` }}
        />
      ))}
    </div>
  )
}

type ComposerBarProps = {
  messages: ReturnType<typeof useMessages>
  media: ReturnType<typeof useMediaCapture>
  activeChat: ChatSummary | null
  chatList: ReturnType<typeof useChatList>
  sendKey?: 'enter' | 'ctrl-enter'
  onDraftChange?: (text: string) => void
  onMessageSent?: () => void
}

export function ComposerBar({ messages, media, activeChat, chatList, sendKey = 'enter', onDraftChange, onMessageSent }: ComposerBarProps) {
  const {
    attachPopoverOpen,
    setAttachPopoverOpen,
    draftInputRef
  } = useUIContext()

  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [videoDuration, setVideoDuration] = useState(0)
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const attachDropdownRef = useRef<HTMLDivElement>(null)

  // Close attach popover on outside click
  useEffect(() => {
    if (!attachPopoverOpen) return
    function handlePointerDown(e: PointerEvent) {
      if (attachDropdownRef.current && !attachDropdownRef.current.contains(e.target as Node)) {
        setAttachPopoverOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [attachPopoverOpen, setAttachPopoverOpen])

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

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await messages.sendDraftMessage(chatList.activeChatId)
    // Reset textarea height after send
    if (draftInputRef.current) {
      draftInputRef.current.style.height = 'auto'
    }
    onMessageSent?.()
  }

  const handleEmojiSelect = useCallback((emoji: string) => {
    const textarea = draftInputRef.current
    if (textarea) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const before = messages.draft.slice(0, start)
      const after = messages.draft.slice(end)
      const newDraft = before + emoji + after
      messages.setDraft(newDraft)
      onDraftChange?.(newDraft)
      // Restore cursor position after the inserted emoji
      requestAnimationFrame(() => {
        const pos = start + emoji.length
        textarea.selectionStart = pos
        textarea.selectionEnd = pos
        textarea.focus()
      })
    } else {
      messages.setDraft(messages.draft + emoji)
      onDraftChange?.(messages.draft + emoji)
    }
  }, [messages, draftInputRef, onDraftChange])

  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const target = e.target
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, 160)}px`
  }, [])

  function handleDiscardVoiceRecording() {
    void media.discardVoiceNoteRecording()
  }

  if (!activeChat) {
    return null
  }

  // ─── Round video recording UI (bottom bar only — overlay is in ConversationPane) ─
  if (media.roundVideoRecording) {
    return (
      <div className="voice-recorder voice-recorder--video">
        <div className="voice-recorder__left">
          <div className="voice-recorder__indicator voice-recorder__indicator--video" />
          <span className="voice-recorder__duration">
            {String(Math.floor(videoDuration / 60)).padStart(2, '0')}:{String(videoDuration % 60).padStart(2, '0')}
          </span>
        </div>
        <LiveWaveform analyserRef={media.videoAnalyserRef} />
        <div className="voice-recorder__right">
          <button
            className="voice-recorder__circle-btn"
            type="button"
            aria-label="Discard recording"
            onClick={() => { void media.handleRoundVideoToggle() }}
          >
            <DeleteIcon />
          </button>
          <button
            className="voice-recorder__circle-btn"
            type="button"
            aria-label="Pause recording"
            disabled
          >
            <PauseIcon />
          </button>
          <button className="voice-recorder__send-pill" type="button" aria-label="Stop and send video" onClick={() => void media.handleRoundVideoToggle()}>
            <SendIcon stroke="white" />
            <span>Send</span>
          </button>
        </div>
      </div>
    )
  }

  // ─── Voice note recording UI ───────────────────────────────────────────────
  if (media.voiceNoteRecording) {
    return (
      <div className="voice-recorder">
        <div className="voice-recorder__left">
          <div className="voice-recorder__indicator" />
          <span className="voice-recorder__duration">
            {String(Math.floor(media.voiceRecordingDuration / 60)).padStart(2, '0')}:{String(media.voiceRecordingDuration % 60).padStart(2, '0')}
          </span>
        </div>
        <LiveWaveform analyserRef={media.voiceAnalyserRef} />
        <div className="voice-recorder__right">
          <button
            className="voice-recorder__circle-btn"
            type="button"
            aria-label="Discard recording"
            onClick={handleDiscardVoiceRecording}
          >
            <DeleteIcon />
          </button>
          <button
            className="voice-recorder__circle-btn"
            type="button"
            aria-label="Pause recording"
            disabled
          >
            <PauseIcon />
          </button>
          <button className="voice-recorder__send-pill" type="button" aria-label="Send voice note" onClick={() => void media.handleVoiceNoteToggle()}>
            <SendIcon stroke="white" />
            <span>Send</span>
          </button>
        </div>
      </div>
    )
  }

  // ─── Normal composer ───────────────────────────────────────────────────────
  return (
    <form className="live-composer" onSubmit={handleSendMessage}>
      <input hidden onChange={media.handleAttachmentPick} ref={media.fileInputRef} type="file" />

      {/* Reply bar — sits above the compose row */}
      <AnimatePresence>
        {messages.replyTargetMessageId ? (
          <motion.div
            key="reply-bar"
            className="compose-reply-bar"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="compose-reply-bar__accent" />
            <div className="compose-reply-bar__content">
              <strong>{messages.editingMessageId ? 'Editing' : 'Reply'}</strong>
              <span>{messages.replyTargetMessage ? messages.replyTargetMessage.text : 'Earlier message'}</span>
            </div>
            <button className="compose-reply-bar__close" type="button" onClick={() => messages.setReplyTargetMessageId(null)} aria-label="Cancel reply">
              <CloseIcon width={16} height={16} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Edit bar — sits above the compose row */}
      <AnimatePresence>
        {messages.editingMessageId && !messages.replyTargetMessageId ? (
          <motion.div
            key="edit-bar"
            className="compose-edit-bar"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <EditSmallIcon />
            <span>Edit Message</span>
            <button className="compose-edit-bar__close" type="button" onClick={() => { messages.setEditingMessageId(null); messages.setDraft('') }} aria-label="Cancel edit">
              <CloseIcon width={16} height={16} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Main compose row */}
      <div className="live-composer__row">
        <div className="dropdown-anchor" ref={attachDropdownRef}>
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
          <div className="emoji-picker-anchor">
            <button className="live-composer__field-icon" type="button" aria-label="Emoji" onClick={() => setEmojiPickerOpen((v) => !v)}>
              <SmileIcon width={20} height={20} />
            </button>
            <EmojiPicker open={emojiPickerOpen} onClose={() => setEmojiPickerOpen(false)} onSelect={handleEmojiSelect} />
          </div>
          <textarea
            className="live-composer__input"
            onChange={(event) => { messages.setDraft(event.target.value); onDraftChange?.(event.target.value); handleTextareaInput(event) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const shouldSend = sendKey === 'enter' ? !e.ctrlKey && !e.metaKey && !e.shiftKey : (e.ctrlKey || e.metaKey)
                if (shouldSend && messages.draft.trim().length > 0) {
                  e.preventDefault()
                  void messages.sendDraftMessage(chatList.activeChatId)
                  if (draftInputRef.current) draftInputRef.current.style.height = 'auto'
                  onMessageSent?.()
                }
              }
            }}
            placeholder={messages.editingMessageId ? 'Edit message\u2026' : 'Write a message...'}
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
        ) : null}
        <Tooltip text="Record voice message">
          <button
            className="live-composer__btn live-composer__mic"
            type="button"
            aria-label="Record voice message"
            onClick={() => { void media.handleVoiceNoteToggle() }}
          >
            <MicIcon width={20} height={20} />
          </button>
        </Tooltip>
        <Tooltip text="Record video message">
          <button
            className="live-composer__btn live-composer__mic"
            type="button"
            aria-label="Record video message"
            onClick={() => { void media.handleRoundVideoToggle() }}
          >
            <VideoCamIcon width={20} height={20} />
          </button>
        </Tooltip>
      </div>
    </form>
  )
}
