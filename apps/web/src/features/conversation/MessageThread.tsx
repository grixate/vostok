import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MessageBubble } from '@vostok/ui-chat'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { useProfilePhotos } from '../../hooks/useProfilePhotos.ts'
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
import { chatAvatarColor } from '../../utils/avatar-colors.ts'
import { VoiceNotePlayer } from '../../components/VoiceNotePlayer.tsx'
import { RoundVideoPlayer } from '../../components/RoundVideoPlayer.tsx'
import { VoiceMessageBubble } from './VoiceMessageBubble.tsx'
import { RoundVideoBubble } from './RoundVideoBubble.tsx'
import { ChevronDownIcon, ForwardSmallIcon, CopySmallIcon, DeleteSmallTrashIcon, CheckIcon, SendIcon } from '../../icons/index.tsx'
import type { useMessages } from '../../hooks/useMessages.ts'
import type { useMediaCapture } from '../../hooks/useMediaCapture.ts'
import type { ChatSummary } from '../../lib/api.ts'

type MessageThreadProps = {
  messages: ReturnType<typeof useMessages>
  media: ReturnType<typeof useMediaCapture>
  activeChat: ChatSummary | null
  searchHighlight?: { query: string; activeMessageId?: string } | null
  initialSelectedMessageId?: string | null
  onSayHello?: () => void
  onOpenMedia?: (url: string, type: 'image' | 'video', senderName: string, timestamp: string, fileName: string) => void
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

export function MessageThread({ messages, media, activeChat, searchHighlight, initialSelectedMessageId, onSayHello, onOpenMedia }: MessageThreadProps) {
  const { storedDevice } = useAppContext()
  const { setContextMenuMessage, draftInputRef } = useUIContext()

  // Build username → userId map for avatar photos
  const usernameToUserId = useMemo(() => {
    const map = new Map<string, string>()
    if (activeChat.participant_usernames && activeChat.participant_user_ids) {
      for (let i = 0; i < activeChat.participant_usernames.length; i++) {
        map.set(activeChat.participant_usernames[i], activeChat.participant_user_ids[i])
      }
    }
    return map
  }, [activeChat.participant_usernames, activeChat.participant_user_ids])
  const participantPhotos = useProfilePhotos(activeChat.participant_user_ids ?? [])
  // Read the current user's profile name for sender display (storedDevice.username may be empty)
  const currentUsername = useMemo(() => {
    try {
      const raw = window.localStorage.getItem('vostok.auth')
      if (raw) {
        const session = JSON.parse(raw) as { user?: { username?: string; display_name?: string | null } }
        return session.user?.display_name || session.user?.username || storedDevice?.username || ''
      }
    } catch { /* ignore */ }
    return storedDevice?.username || ''
  }, [storedDevice?.username])

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

  // Enter selection mode when initialSelectedMessageId changes
  useEffect(() => {
    if (initialSelectedMessageId) {
      setSelectedMessageIds(new Set([initialSelectedMessageId]))
      lastClickedIdRef.current = initialSelectedMessageId
    }
  }, [initialSelectedMessageId])

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
        // When an optimistic message (optimistic-<clientId>) is replaced by
        // the server-confirmed message (UUID id, same clientId), the new UUID
        // is unknown.  Detect this case and suppress the enter animation so
        // the message doesn't visually "pop" a second time.
        const msg = messages.messageItems.find((m) => m.id === id)
        const wasOptimistic = msg?.clientId && known.has(`optimistic-${msg.clientId}`)

        if (!wasOptimistic) {
          newIds.add(id)
        }
      }
    }

    if (newIds.size > 0) {
      setAnimatingIds(newIds)
    }

    knownMessageIdsRef.current = currentIds

    if (newIds.size > 0) {
      // Clear animation classes after they complete
      const timer = setTimeout(() => {
        setAnimatingIds(new Set())
      }, 250)
      return () => clearTimeout(timer)
    }
  }, [messages.messageItems])

  // Reset known message IDs when switching chats
  useEffect(() => {
    knownMessageIdsRef.current = new Set()
    setAnimatingIds(new Set())
  }, [activeChat?.id])

  // --- Scroll tracking ---
  const initialScrollDoneRef = useRef(false)
  const prevScrollHeightRef = useRef(0)
  const isLoadingOlderRef = useRef(false)

  // Track loadingOlder in a ref so the layout effect can read it synchronously
  useEffect(() => {
    isLoadingOlderRef.current = messages.loadingOlder
  }, [messages.loadingOlder])

  // Keep refs for scroll handler to avoid stale closures
  const hasMoreRef = useRef(messages.hasMoreMessages)
  const loadingOlderForScrollRef = useRef(messages.loadingOlder)
  const activeChatIdForScrollRef = useRef(activeChat?.id)
  hasMoreRef.current = messages.hasMoreMessages
  loadingOlderForScrollRef.current = messages.loadingOlder
  activeChatIdForScrollRef.current = activeChat?.id

  const handleScroll = useCallback(() => {
    const el = stageRef.current
    if (!el) return

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isNearBottomRef.current = distanceFromBottom < 100
    setShowScrollFab(distanceFromBottom > 200)

    // Lazy load older messages when scrolled near top
    if (el.scrollTop < 200 && hasMoreRef.current && !loadingOlderForScrollRef.current && activeChatIdForScrollRef.current) {
      messages.loadOlderMessages(activeChatIdForScrollRef.current)
    }
  }, [])

  // Scroll to bottom on initial load / chat switch
  useEffect(() => {
    initialScrollDoneRef.current = false
    prevScrollHeightRef.current = 0

    // Messages may already be in the DOM (cached from hook state).
    // Schedule repeated scroll-to-bottom attempts to handle cases where
    // the DOM isn't fully laid out yet (images loading, layout shifts).
    const el = stageRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
    const raf1 = requestAnimationFrame(() => {
      if (stageRef.current) stageRef.current.scrollTop = stageRef.current.scrollHeight
    })
    const timer = setTimeout(() => {
      if (stageRef.current) stageRef.current.scrollTop = stageRef.current.scrollHeight
      initialScrollDoneRef.current = true
      prevScrollHeightRef.current = stageRef.current?.scrollHeight ?? 0
    }, 100)

    return () => {
      cancelAnimationFrame(raf1)
      clearTimeout(timer)
    }
  }, [activeChat?.id])

  // Use useLayoutEffect for scroll anchoring — runs synchronously after DOM
  // mutations but before paint, so the user never sees a scroll jump.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el || messages.messageItems.length === 0) return

    if (!initialScrollDoneRef.current) {
      // First batch or chat switch: snap to bottom instantly
      el.scrollTop = el.scrollHeight
      initialScrollDoneRef.current = true
      prevScrollHeightRef.current = el.scrollHeight
      // Double-check after paint — images/thumbnails may alter scroll height
      requestAnimationFrame(() => {
        if (el.scrollTop < el.scrollHeight - el.clientHeight - 50) {
          el.scrollTop = el.scrollHeight
        }
      })
    } else {
      // Older messages prepended: adjust scroll to maintain position
      const addedHeight = el.scrollHeight - prevScrollHeightRef.current
      if (addedHeight > 0 && isLoadingOlderRef.current) {
        el.scrollTop += addedHeight
      } else if (addedHeight > 0) {
        // New message arrived — check if user was near bottom before this
        // message was added. Use the previous scroll height to determine
        // if the user was at the bottom before the DOM grew.
        const wasNearBottom =
          isNearBottomRef.current ||
          (el.scrollHeight - addedHeight - el.scrollTop - el.clientHeight < 100)

        if (wasNearBottom) {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
        }
      }
      prevScrollHeightRef.current = el.scrollHeight
    }
  }, [messages.messageItems.length, activeChat?.id])

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

  const toggleSelection = useCallback((messageId: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }, [])

  const handleEnterSelectionMode = useCallback((messageId: string) => {
    setSelectedMessageIds(new Set([messageId]))
    lastClickedIdRef.current = messageId
  }, [])

  // Left-click toggles selection when in selection mode
  const handleMessageClick = useCallback((messageId: string, _event: React.MouseEvent) => {
    if (selectedMessageIds.size > 0) {
      toggleSelection(messageId)
    }
  }, [selectedMessageIds.size, toggleSelection])

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

  // --- Eagerly resolve voice/video playback URLs ---
  const playbackUrlsRef = useRef<Record<string, string>>({})
  const [playbackUrls, setPlaybackUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    for (const message of messages.messageItems) {
      if (!message.attachment?.contentKeyBase64 || !message.attachment.ivBase64) continue
      const isVoice = isVoiceNoteAttachment(message.attachment)
      const isVideo = isRoundVideoAttachment(message.attachment)
      if (!isVoice && !isVideo) continue
      const uploadId = message.attachment.uploadId
      if (playbackUrlsRef.current[uploadId]) continue
      // Mark as in-flight so we don't re-request
      playbackUrlsRef.current[uploadId] = ''
      const descriptor = toAttachmentDescriptor(message.attachment)
      media.ensureAttachmentPlaybackUrl(descriptor)
        .then((url) => {
          playbackUrlsRef.current[uploadId] = url
          setPlaybackUrls((prev) => ({ ...prev, [uploadId]: url }))
        })
        .catch(() => {
          // Allow retry on next render
          delete playbackUrlsRef.current[uploadId]
        })
    }
  }, [messages.messageItems])

  // Merge local blob URLs from media capture (for optimistic messages) with eagerly resolved URLs
  const allPlaybackUrls = { ...media.attachmentPlaybackUrls, ...playbackUrls }

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

  // Compute message groups for flat layout (sender + within 5-minute window).
  // Prefer senderUsername for grouping (stable across device changes);
  // fall back to senderId (device ID), then side.
  const groupInfo = useMemo(() => messages.messageItems.map((message, index) => {
    const prev = index > 0 ? messages.messageItems[index - 1] : null
    if (!prev) return { isFirstInGroup: true }
    if (message.side === 'system' || prev.side === 'system') return { isFirstInGroup: true }
    const prevSentAt = prev.sentAt ? new Date(prev.sentAt).getTime() : 0
    const thisSentAt = message.sentAt ? new Date(message.sentAt).getTime() : 0
    const withinTimeWindow = (thisSentAt - prevSentAt) < 5 * 60 * 1000
    const sameSide = message.side === prev.side
    const sameSender =
      message.senderUsername && prev.senderUsername
        ? message.senderUsername === prev.senderUsername
        : message.senderId && prev.senderId
          ? message.senderId === prev.senderId
          : sameSide
    const sameGroup = sameSender && sameSide && withinTimeWindow
    return { isFirstInGroup: !sameGroup }
  }), [messages.messageItems])

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
            <div className="conversation-stage__saved-bookmark">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="conversation-stage__saved-title">Your Cloud Storage</p>
            <p className="conversation-stage__saved-body">
              Forward messages here to save them and access them from any of your devices.
            </p>
          </div>
        ) : (
          <div className="conversation-stage__empty conversation-stage__empty--hello">
            <div
              className="conversation-stage__hello-avatar"
              style={{ background: chatAvatarColor(activeChat.title, false) }}
            >
              {activeChat.title.slice(0, 1).toUpperCase()}
            </div>
            <p className="conversation-stage__hello-name">{activeChat.title}</p>
            <p className="conversation-stage__hello-body">
              Start a conversation with {activeChat.title}.
            </p>
            <button
              className="conversation-stage__hello-btn"
              type="button"
              onClick={onSayHello}
            >
              <SendIcon stroke="currentColor" />
              Say hello
            </button>
          </div>
        )
      ) : (
        <div className="message-thread">
          {messages.loadingOlder ? (
            <div className="message-thread__loading-older">
              <span className="message-thread__loading-spinner" />
            </div>
          ) : null}
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

            const isVoice = message.attachment ? isVoiceNoteAttachment(message.attachment) : false
            const isRoundVideo = message.attachment ? isRoundVideoAttachment(message.attachment) : false
            const isImageAttachment = !!(message.attachment?.contentType?.startsWith('image/') && message.attachment.thumbnailDataUrl)
            const isMediaMessage = isVoice || isRoundVideo || isImageAttachment

            const isSelected = selectedMessageIds.has(message.id)
            const isActiveSearchMatch = searchHighlight?.activeMessageId === message.id
            const { isFirstInGroup } = groupInfo[index]
            const isGroup = activeChat.type === 'group'
            // Resolve sender display name
            const rawSenderName = message.senderUsername ?? ''
            let senderName = rawSenderName
            if (!senderName) {
              senderName = currentUsername
            }
            if (!senderName && message.side === 'incoming' && !activeChat.is_self_chat) {
              senderName = activeChat.title
            }
            const showSenderName = isFirstInGroup && !!senderName && message.side !== 'system'
            const avatarColor = avatarColorForSender(senderName)

            return (
            <div
              key={message.clientId || message.id}
              ref={(el) => { messageRefsMap.current[message.id] = el }}
              className={getWrapperClassName(message, isSelected, isActiveSearchMatch, isFirstInGroup, index)}
              onClick={(e) => handleMessageClick(message.id, e)}
              onDoubleClick={() => handleDoubleClick(message)}
            >
            {selectedMessageIds.size > 0 && message.side !== 'system' ? (
              <button
                className={`selection-check${selectedMessageIds.has(message.id) ? ' selection-check--active' : ''}`}
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleSelection(message.id) }}
              >
                {selectedMessageIds.has(message.id) ? <CheckIcon /> : null}
              </button>
            ) : null}
            {message.side !== 'system' ? (
              <div className={`message-row${message.side === 'outgoing' ? ' message-row--outgoing' : ''}`}>
                <div
                  className={`message-row__avatar${
                    !isFirstInGroup ? ' message-row__avatar--spacer' : ''
                  }`}
                  style={{
                    background: isFirstInGroup && !participantPhotos.get(usernameToUserId.get(message.senderUsername ?? '') ?? '') ? avatarColor : undefined,
                  }}
                >
                  {isFirstInGroup
                    ? (() => {
                        const senderUserId = usernameToUserId.get(message.senderUsername ?? '')
                        const photoUrl = senderUserId ? participantPhotos.get(senderUserId) : null
                        return photoUrl
                          ? <img src={photoUrl} alt={senderName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                          : senderName.slice(0, 1).toUpperCase()
                      })()
                    : ''}
                </div>
                <div className="message-row__body">
                  {showSenderName ? (
                    <span className="message-row__sender">{senderName}</span>
                  ) : null}
                  {/* Forwarded header */}
                  {message.forwardedFrom ? (
                    <span className="message-row__forwarded">↪ Forwarded from {message.forwardedFrom.senderName}</span>
                  ) : null}
                  {/* ── Round video: rendered standalone (no bubble wrapper) ── */}
                  {isRoundVideo ? (
                    <>
                      {attachmentDescriptor && message.attachment && allPlaybackUrls[message.attachment.uploadId] ? (
                        <RoundVideoBubble
                          descriptor={attachmentDescriptor}
                          playbackUrl={allPlaybackUrls[message.attachment.uploadId]}
                          side={message.side as 'incoming' | 'outgoing'}
                          timestamp={`${formatRelativeTime(message.sentAt)}${message.editedAt ? ' edited' : ''}`}
                        />
                      ) : attachmentDescriptor && message.attachment ? (
                        <RoundVideoPlayer
                          attachment={attachmentDescriptor}
                          onResolveMediaUrl={media.ensureAttachmentPlaybackUrl}
                        />
                      ) : (
                        <div className={`round-video round-video--${message.side === 'outgoing' ? 'outgoing' : 'incoming'} round-video--loading`}>
                          <div className="round-video__wrapper" style={{ width: 180, height: 180 }}>
                            {message.attachment?.thumbnailDataUrl ? (
                              <img
                                alt="Video message"
                                className="round-video__video"
                                src={message.attachment.thumbnailDataUrl}
                                style={{ width: 174, height: 174, top: 3, left: 3, position: 'absolute', borderRadius: '50%', objectFit: 'cover' }}
                              />
                            ) : allPlaybackUrls[message.attachment?.uploadId ?? ''] ? (
                              <video
                                className="round-video__video"
                                src={allPlaybackUrls[message.attachment?.uploadId ?? '']}
                                style={{ width: 174, height: 174, top: 3, left: 3, position: 'absolute', borderRadius: '50%', objectFit: 'cover' }}
                                muted
                                playsInline
                              />
                            ) : null}
                            <div className="round-video__play-overlay" style={{ cursor: 'default' }}>
                              <span className="round-video__loading-spinner" />
                            </div>
                          </div>
                          <div className="round-video__caption">
                            <span className="round-video__time">{formatRelativeTime(message.sentAt)}</span>
                          </div>
                        </div>
                      )}
                      {message.reactions && message.reactions.length > 0 ? (
                        <div className="message-thread__reactions">
                          {message.reactions.map((reaction) => (
                            <span
                              key={reaction.reactionKey}
                              className={`message-thread__reaction-chip${reaction.reacted ? ' message-thread__reaction-chip--own' : ''}`}
                            >
                              <span className="message-thread__reaction-emoji">{reaction.reactionKey}</span>
                              <span className="message-thread__reaction-count">{reaction.count}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                  /* ── Regular message bubble (including voice messages) ── */
                  <MessageBubble
              side={message.side}
              timestamp={`${formatRelativeTime(message.sentAt)}${message.editedAt ? ' edited' : ''}`}
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
              {/* Hide raw "Attachment: ..." text for voice/image messages — the bubble shows the media instead */}
              {isVoice || isImageAttachment ? null : (
                <span>{searchQuery ? highlightText(message.text, searchQuery) : message.text}</span>
              )}
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
              {message.attachment?.thumbnailDataUrl && !isVoice && !isRoundVideo ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img
                    alt={message.attachment.fileName}
                    className="message-thread__attachment-preview"
                    src={message.attachment.thumbnailDataUrl}
                    style={{ cursor: media.expiredMediaIds.has(message.attachment.uploadId) ? 'default' : 'pointer', opacity: media.expiredMediaIds.has(message.attachment.uploadId) ? 0.5 : 1 }}
                    onClick={(e) => {
                      if (media.expiredMediaIds.has(message.attachment!.uploadId)) return
                      e.stopPropagation()
                      const isVideo = message.attachment!.contentType?.startsWith('video/') ?? false
                      onOpenMedia?.(
                        message.attachment!.thumbnailDataUrl!,
                        isVideo ? 'video' : 'image',
                        senderName,
                        formatRelativeTime(message.sentAt),
                        message.attachment!.fileName
                      )
                    }}
                  />
                  {media.expiredMediaIds.has(message.attachment.uploadId) && (
                    <span style={{
                      position: 'absolute', bottom: 8, left: 8, right: 8,
                      background: 'rgba(0,0,0,0.7)', color: '#aaa', fontSize: 12,
                      padding: '4px 8px', borderRadius: 6, textAlign: 'center',
                    }}>
                      Media expired
                    </span>
                  )}
                </div>
              ) : null}
              {/* Voice message: waveform bubble or skeleton loading */}
              {isVoice ? (
                attachmentDescriptor && message.attachment && allPlaybackUrls[message.attachment.uploadId] ? (
                  <VoiceMessageBubble
                    descriptor={attachmentDescriptor}
                    playbackUrl={allPlaybackUrls[message.attachment.uploadId]}
                    side={message.side as 'incoming' | 'outgoing'}
                  />
                ) : attachmentDescriptor && message.attachment ? (
                  <VoiceNotePlayer
                    attachment={attachmentDescriptor}
                    onResolveMediaUrl={media.ensureAttachmentPlaybackUrl}
                  />
                ) : (
                  <div className="voice-skeleton">
                    <div className="voice-skeleton__btn" />
                    <div className="voice-skeleton__bars">
                      {Array.from({ length: 20 }, (_, i) => (
                        <div key={i} className="voice-skeleton__bar" style={{ height: `${8 + Math.sin(i * 0.7) * 12}px` }} />
                      ))}
                    </div>
                    <div className="voice-skeleton__time" />
                  </div>
                )
              ) : null}
              {/* Download button: skip for voice/video/image messages */}
              {attachmentDescriptor && !isMediaMessage ? (
                media.expiredMediaIds.has(attachmentDescriptor.uploadId) ? (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    File expired — no longer available on server
                  </span>
                ) : (
                  <button
                    className="secondary-action"
                    onClick={() => media.handleDownloadAttachment(attachmentDescriptor)}
                    type="button"
                  >
                    Download {attachmentDescriptor.fileName}
                  </button>
                )
              ) : null}
              {message.reactions && message.reactions.length > 0 ? (
                <div className="message-thread__reactions">
                  {message.reactions.map((reaction) => (
                    <span
                      key={reaction.reactionKey}
                      className={`message-thread__reaction-chip${reaction.reacted ? ' message-thread__reaction-chip--own' : ''}`}
                    >
                      <span className="message-thread__reaction-emoji">{reaction.reactionKey}</span>
                      <span className="message-thread__reaction-count">{reaction.count}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </MessageBubble>
                  )}
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

      <div className={showScrollFab ? 'scroll-to-bottom-fab-wrap' : 'scroll-to-bottom-fab-wrap scroll-to-bottom-fab-wrap--hidden'}>
        <button
          className="scroll-to-bottom-fab"
          type="button"
          onClick={handleScrollToBottom}
          aria-label="Scroll to bottom"
        >
          <ChevronDownIcon width={20} height={20} />
        </button>
      </div>

      {selectedMessageIds.size > 0 ? (
        <div className="selection-bar">
          <span className="selection-bar__count">{selectedMessageIds.size} selected</span>
          <div className="selection-bar__actions">
            <button className="selection-bar__icon-btn" type="button" disabled aria-label="Forward">
              <ForwardSmallIcon />
            </button>
            <button className="selection-bar__icon-btn" type="button" onClick={handleCopySelected} aria-label="Copy">
              <CopySmallIcon />
            </button>
            <button className="selection-bar__icon-btn selection-bar__icon-btn--danger" type="button" disabled aria-label="Delete">
              <DeleteSmallTrashIcon />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
