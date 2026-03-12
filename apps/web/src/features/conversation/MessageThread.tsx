import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageBubble } from '@vostok/ui-chat'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { PinnedBar } from './PinnedBar.tsx'
import {
  extractFirstHttpUrl,
  formatRelativeTime,
  resolveLinkPreview,
  resolveReplyPreview
} from '../../utils/format.ts'
import {
  toAttachmentDescriptor,
  isVoiceNoteAttachment,
  isRoundVideoAttachment
} from '../../utils/attachment-helpers.ts'
import { VoiceNotePlayer } from '../../components/VoiceNotePlayer.tsx'
import { RoundVideoPlayer } from '../../components/RoundVideoPlayer.tsx'
import { ChevronDownIcon } from '../../icons/index.tsx'
import type { useMessages } from '../../hooks/useMessages.ts'
import type { useMediaCapture } from '../../hooks/useMediaCapture.ts'
import type { ChatSummary } from '../../lib/api.ts'

type MessageThreadProps = {
  messages: ReturnType<typeof useMessages>
  media: ReturnType<typeof useMediaCapture>
  activeChat: ChatSummary | null
  searchHighlight?: { query: string; activeMessageId?: string } | null
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text
  const escaped = escapeRegex(query)
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    regex.test(part) ? <mark key={i}>{part}</mark> : part
  )
}

export function MessageThread({ messages, media, activeChat, searchHighlight }: MessageThreadProps) {
  const { setContextMenuMessage, draftInputRef } = useUIContext()

  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set())
  const lastClickedIdRef = useRef<string | null>(null)
  const messageRefsMap = useRef<Record<string, HTMLDivElement | null>>({})

  // --- Message enter animations ---
  const knownMessageIdsRef = useRef<Set<string>>(new Set())
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set())

  // --- Scroll state ---
  const stageRef = useRef<HTMLElement | null>(null)
  const [showScrollFab, setShowScrollFab] = useState(false)
  const isNearBottomRef = useRef(true)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)

  // Track new messages for enter animation
  useEffect(() => {
    const currentIds = new Set(messages.messageItems.map((m) => m.id))
    const known = knownMessageIdsRef.current

    // On first render or chat switch, seed known IDs without animating
    if (known.size === 0) {
      knownMessageIdsRef.current = currentIds
      return
    }

    const newIds = new Set<string>()
    for (const id of currentIds) {
      if (!known.has(id)) {
        newIds.add(id)
      }
    }

    if (newIds.size > 0) {
      setAnimatingIds(newIds)
      knownMessageIdsRef.current = currentIds

      // Clear animation classes after they complete
      const timer = setTimeout(() => {
        setAnimatingIds(new Set())
      }, 250)
      return () => clearTimeout(timer)
    }

    knownMessageIdsRef.current = currentIds
  }, [messages.messageItems])

  // Reset known message IDs when switching chats
  useEffect(() => {
    knownMessageIdsRef.current = new Set()
    setAnimatingIds(new Set())
  }, [activeChat?.id])

  // --- Scroll tracking ---
  const handleScroll = useCallback(() => {
    const el = stageRef.current
    if (!el) return

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isNearBottomRef.current = distanceFromBottom < 100
    setShowScrollFab(distanceFromBottom > 200)
  }, [])

  // Auto-scroll to bottom on new messages if user is near bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      const el = stageRef.current
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      }
    }
  }, [messages.messageItems.length])

  const handleScrollToBottom = useCallback(() => {
    const el = stageRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [])

  // Scroll to active search match
  useEffect(() => {
    if (!searchHighlight?.activeMessageId) return

    const element = messageRefsMap.current[searchHighlight.activeMessageId]
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [searchHighlight?.activeMessageId])

  // Clear selection when active chat changes
  useEffect(() => {
    setSelectedMessageIds(new Set())
    lastClickedIdRef.current = null
  }, [activeChat?.id])

  // Escape key clears selection
  useEffect(() => {
    if (selectedMessageIds.size === 0) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedMessageIds(new Set())
        lastClickedIdRef.current = null
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedMessageIds.size])

  // Left-click does nothing; selection is available via context menu "Select"
  const handleMessageClick = useCallback((_messageId: string, _event: React.MouseEvent) => {}, [])

  const handleDoubleClick = useCallback((message: typeof messages.messageItems[number]) => {
    // Guard: if user is selecting text, don't trigger reply
    const selection = window.getSelection()?.toString()
    if (selection && selection.length > 0) return

    if (message.side === 'system' || message.deletedAt) return

    messages.handleReplyToMessage(message)
    draftInputRef.current?.focus()
  }, [messages, draftInputRef])

  const handleCopySelected = useCallback(() => {
    const selectedTexts = messages.messageItems
      .filter((m) => selectedMessageIds.has(m.id))
      .map((m) => m.text)
      .join('\n')

    void navigator.clipboard.writeText(selectedTexts)
    setSelectedMessageIds(new Set())
  }, [messages.messageItems, selectedMessageIds])

  const handleClearSelection = useCallback(() => {
    setSelectedMessageIds(new Set())
    lastClickedIdRef.current = null
  }, [])

  const handleScrollToMessage = useCallback((messageId: string) => {
    const element = messageRefsMap.current[messageId]
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // Flash highlight on the target message
      setHighlightedMessageId(messageId)
      const timer = setTimeout(() => {
        setHighlightedMessageId(null)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [])

  // Handle clicking a reply preview to scroll to the referenced message
  const handleReplyPreviewClick = useCallback((replyToMessageId: string) => {
    handleScrollToMessage(replyToMessageId)
  }, [handleScrollToMessage])

  const searchQuery = searchHighlight?.query ?? ''
  const { contextMenuMessage } = useUIContext()

  // Build class name for each message wrapper
  const getWrapperClassName = (message: typeof messages.messageItems[number], isSelected: boolean, isActiveSearchMatch: boolean, isFirstInGroup: boolean, index: number) => {
    const classes = ['message-bubble-wrapper']

    if (isSelected) {
      classes.push('message-bubble-wrapper--selected')
    } else if (isActiveSearchMatch) {
      classes.push('message-bubble-wrapper--search-active')
    }

    if (animatingIds.has(message.id)) {
      if (message.side === 'outgoing') {
        classes.push('message-bubble-wrapper--entering-outgoing')
      } else if (message.side === 'incoming') {
        classes.push('message-bubble-wrapper--entering-incoming')
      }
    }

    if (highlightedMessageId === message.id) {
      classes.push('message-bubble-wrapper--highlighted')
    }

    if (contextMenuMessage?.message.id === message.id) {
      classes.push('message-bubble-wrapper--context-active')
    }

    if (isFirstInGroup && index > 0) {
      classes.push('message-bubble-wrapper--group-start')
    }

    return classes.join(' ')
  }

  // Compute message groups for flat layout (sender + within 5-minute window)
  const groupInfo = messages.messageItems.map((message, index) => {
    const prev = index > 0 ? messages.messageItems[index - 1] : null
    const prevSenderId = prev?.senderId ?? ''
    const prevSentAt = prev?.sentAt ? new Date(prev.sentAt).getTime() : 0
    const thisSentAt = message.sentAt ? new Date(message.sentAt).getTime() : 0
    const sameGroup =
      prev !== null &&
      prevSenderId === message.senderId &&
      message.side === prev.side &&
      (thisSentAt - prevSentAt) < 5 * 60 * 1000
    return { isFirstInGroup: !sameGroup }
  })

  // Derive avatar color from sender using Telegram 8-color peer ring
  const avatarColorForSender = (username: string) => {
    const peerColors = [
      'var(--peer-1)', 'var(--peer-2)', 'var(--peer-3)', 'var(--peer-4)',
      'var(--peer-5)', 'var(--peer-6)', 'var(--peer-7)', 'var(--peer-8)',
    ]
    let hash = 0
    for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) | 0
    return peerColors[Math.abs(hash) % peerColors.length]
  }

  return (
    <section className="conversation-stage" ref={stageRef} onScroll={handleScroll}>
      <PinnedBar
        messageItems={messages.messageItems}
        onScrollToMessage={handleScrollToMessage}
      />
      {!activeChat ? null : messages.messageItems.length === 0 ? (
        activeChat.is_self_chat ? (
          <div className="conversation-stage__empty conversation-stage__empty--saved">
            <div className="conversation-stage__saved-icon">🔖</div>
            <p className="conversation-stage__saved-title">Your Cloud Storage</p>
            <p className="conversation-stage__saved-body">
              Forward messages here to save them and access them from any of your devices.
            </p>
          </div>
        ) : (
          <div className="conversation-stage__empty">
            <p style={{ fontSize: 15, color: 'var(--label2)', margin: 0 }}>No messages here yet</p>
            <p style={{ fontSize: 13, color: 'var(--label3)', margin: '4px 0 0' }}>Send the first message to start the conversation</p>
          </div>
        )
      ) : (
        <div className="message-thread">
          {messages.messageItems.map((message, index) => {
            const linkUrl = extractFirstHttpUrl(message.text)
            const linkPreview = resolveLinkPreview(
              message.text,
              linkUrl ? messages.linkMetadataByUrl[linkUrl] : null
            )
            const attachmentDescriptor =
              message.attachment?.contentKeyBase64 && message.attachment.ivBase64
                ? toAttachmentDescriptor(message.attachment)
                : null

            const isSelected = selectedMessageIds.has(message.id)
            const isActiveSearchMatch = searchHighlight?.activeMessageId === message.id
            const { isFirstInGroup } = groupInfo[index]
            const isGroup = activeChat.type === 'group'
            // For incoming messages in a 1:1 DM, senderUsername may be null — fall back to the chat title
            const rawSenderName = message.senderUsername ?? ''
            const senderName = (message.side === 'incoming' && !rawSenderName && !activeChat.is_self_chat)
              ? activeChat.title
              : rawSenderName
            const showSenderName = isGroup && isFirstInGroup && !!senderName
            const avatarColor = avatarColorForSender(senderName)

            return (
            <div
              key={message.id}
              ref={(el) => { messageRefsMap.current[message.id] = el }}
              className={getWrapperClassName(message, isSelected, isActiveSearchMatch, isFirstInGroup, index)}
              onClick={(e) => handleMessageClick(message.id, e)}
              onDoubleClick={() => handleDoubleClick(message)}
            >
            {message.side !== 'system' ? (
              <div className={`message-row${message.side === 'outgoing' ? ' message-row--outgoing' : ''}`}>
                <div
                  className={`message-row__avatar${
                    (message.side === 'outgoing' || !isFirstInGroup)
                      ? ' message-row__avatar--spacer'
                      : ''
                  }`}
                  style={{
                    background:
                      message.side === 'incoming' && isFirstInGroup
                        ? avatarColor
                        : undefined,
                  }}
                >
                  {message.side === 'incoming' && isFirstInGroup
                    ? senderName.slice(0, 1).toUpperCase()
                    : ''}
                </div>
                <div className="message-row__body">
                  {showSenderName ? (
                    <span className="message-row__sender">{senderName}</span>
                  ) : null}
                  <MessageBubble
              side={message.side}
              timestamp={formatRelativeTime(message.sentAt)}
              onContextMenu={(e) => {
                if (message.side !== 'system' && !message.deletedAt) {
                  e.preventDefault()
                  setContextMenuMessage({ message, x: e.clientX, y: e.clientY })
                }
              }}
            >
              {message.replyToMessageId ? (
                <span
                  className="message-thread__reply-preview"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); handleReplyPreviewClick(message.replyToMessageId!) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleReplyPreviewClick(message.replyToMessageId!) } }}
                  style={{ cursor: 'pointer' }}
                >
                  {resolveReplyPreview(messages.messageItems, message.replyToMessageId)}
                </span>
              ) : null}
              <span>{searchQuery ? highlightText(message.text, searchQuery) : message.text}</span>
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
                  onResolveMediaUrl={media.ensureAttachmentPlaybackUrl}
                />
              ) : null}
              {attachmentDescriptor && message.attachment && isRoundVideoAttachment(message.attachment) ? (
                <RoundVideoPlayer
                  attachment={attachmentDescriptor}
                  onResolveMediaUrl={media.ensureAttachmentPlaybackUrl}
                />
              ) : null}
              {attachmentDescriptor ? (
                <button
                  className="secondary-action"
                  onClick={() => media.handleDownloadAttachment(attachmentDescriptor)}
                  type="button"
                >
                  Download {attachmentDescriptor.fileName}
                </button>
              ) : null}
              {message.reactions && message.reactions.length > 0 ? (
                <span className="message-thread__reactions">
                  {message.reactions
                    .map((reaction) => `${reaction.reactionKey} ${reaction.count}${reaction.reacted ? '*' : ''}`)
                    .join(' \u2022 ')}
                </span>
              ) : null}
            </MessageBubble>
                </div>
              </div>
            ) : (
              <MessageBubble
                side={message.side}
                timestamp={formatRelativeTime(message.sentAt)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenuMessage({ message, x: e.clientX, y: e.clientY })
                }}
              >
                <span>{searchQuery ? highlightText(message.text, searchQuery) : message.text}</span>
              </MessageBubble>
            )}
            </div>
            )
          })}
        </div>
      )}

      <button
        className={showScrollFab ? 'scroll-to-bottom-fab' : 'scroll-to-bottom-fab scroll-to-bottom-fab--hidden'}
        type="button"
        onClick={handleScrollToBottom}
        aria-label="Scroll to bottom"
      >
        <ChevronDownIcon width={20} height={20} />
      </button>

      {selectedMessageIds.size > 0 ? (
        <div className="selection-bar">
          <span className="selection-bar__count">{selectedMessageIds.size} selected</span>
          <button className="selection-bar__action" type="button" onClick={handleCopySelected}>
            Copy
          </button>
          <button className="selection-bar__action" type="button" disabled>
            Delete
          </button>
          <button className="selection-bar__action" type="button" onClick={handleClearSelection}>
            Clear
          </button>
        </div>
      ) : null}
    </section>
  )
}
