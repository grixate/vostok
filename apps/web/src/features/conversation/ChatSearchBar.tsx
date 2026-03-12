import { useState, useEffect, useMemo, useCallback } from 'react'
import { useUIContext } from '../../contexts/UIContext.tsx'
import type { CachedMessage } from '../../lib/message-cache.ts'
import {
  ChevronUpSmallIcon,
  ChevronDownSmallIcon,
  SearchSmallIcon,
  ClearCircleIcon,
  CloseSmallIcon,
} from '../../icons/index.tsx'

type ChatSearchBarProps = {
  messageItems: CachedMessage[]
  onSearchHighlightChange: (highlight: { query: string; activeMessageId?: string } | null) => void
}

export function ChatSearchBar({ messageItems, onSearchHighlightChange }: ChatSearchBarProps) {
  const {
    chatSearchOpen,
    chatSearchQuery,
    setChatSearchQuery,
    setChatSearchOpen,
    chatSearchInputRef
  } = useUIContext()

  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)

  const matches = useMemo(() => {
    if (!chatSearchQuery.trim()) {
      return []
    }

    const query = chatSearchQuery.trim().toLowerCase()
    return messageItems.filter(
      (message) =>
        !message.deletedAt &&
        message.text.toLowerCase().includes(query)
    )
  }, [chatSearchQuery, messageItems])

  // Reset match index when query or matches change
  useEffect(() => {
    setCurrentMatchIndex(0)
  }, [chatSearchQuery])

  // Emit search highlight changes
  useEffect(() => {
    if (!chatSearchOpen) {
      onSearchHighlightChange(null)
      return
    }

    if (!chatSearchQuery.trim() || matches.length === 0) {
      onSearchHighlightChange(chatSearchQuery.trim() ? { query: chatSearchQuery.trim() } : null)
      return
    }

    const safeIndex = Math.min(currentMatchIndex, matches.length - 1)
    const activeMessage = matches[safeIndex]

    onSearchHighlightChange({
      query: chatSearchQuery.trim(),
      activeMessageId: activeMessage?.id
    })
  }, [chatSearchOpen, chatSearchQuery, matches, currentMatchIndex])

  const handlePrevious = useCallback(() => {
    if (matches.length === 0) return
    setCurrentMatchIndex((prev) => (prev - 1 + matches.length) % matches.length)
  }, [matches.length])

  const handleNext = useCallback(() => {
    if (matches.length === 0) return
    setCurrentMatchIndex((prev) => (prev + 1) % matches.length)
  }, [matches.length])

  const handleClose = useCallback(() => {
    setChatSearchOpen(false)
    setChatSearchQuery('')
  }, [setChatSearchOpen, setChatSearchQuery])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        handlePrevious()
      } else {
        handleNext()
      }
    }
    if (e.key === 'Escape') {
      handleClose()
    }
  }, [handlePrevious, handleNext, handleClose])

  if (!chatSearchOpen) {
    return null
  }

  const safeIndex = matches.length > 0 ? Math.min(currentMatchIndex, matches.length - 1) + 1 : 0

  return (
    <div className="chat-search-bar">
      <button className="chat-search-bar__nav" type="button" aria-label="Previous result" onClick={handlePrevious} disabled={matches.length === 0}>
        <ChevronUpSmallIcon />
      </button>
      <button className="chat-search-bar__nav" type="button" aria-label="Next result" onClick={handleNext} disabled={matches.length === 0}>
        <ChevronDownSmallIcon />
      </button>
      <div className="chat-search-bar__field">
        <SearchSmallIcon />
        <input
          className="chat-search-bar__input"
          placeholder="Search"
          ref={chatSearchInputRef}
          value={chatSearchQuery}
          onChange={(e) => setChatSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        {chatSearchQuery ? (
          <>
            <span className="chat-search-bar__count">
              {matches.length > 0 ? `${safeIndex} of ${matches.length}` : 'No results'}
            </span>
            <button className="chat-search-bar__clear" type="button" onClick={() => setChatSearchQuery('')} aria-label="Clear">
              <ClearCircleIcon width={14} height={14} />
            </button>
          </>
        ) : null}
      </div>
      <button className="chat-search-bar__close" type="button" onClick={handleClose} aria-label="Close search">
        <CloseSmallIcon />
      </button>
    </div>
  )
}
