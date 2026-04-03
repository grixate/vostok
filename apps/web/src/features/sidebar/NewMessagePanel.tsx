import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { SearchIcon } from '../../icons/index.tsx'
import { peerColor } from '../../utils/avatar-colors.ts'
import { listUsers } from '../../lib/api.ts'
import type { useChatList } from '../../hooks/useChatList.ts'

type NewMessagePanelProps = {
  chatList: ReturnType<typeof useChatList>
}

function ContactRow({
  username,
  subtitle,
  highlighted,
  onClick,
}: {
  username: string
  subtitle?: string
  highlighted: boolean
  onClick: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (highlighted && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted])

  return (
    <button
      ref={ref}
      type="button"
      className={`new-message-contact${highlighted ? ' new-message-contact--highlighted' : ''}`}
      onClick={onClick}
      aria-selected={highlighted}
      aria-label={`Start chat with ${username}`}
    >
      <span
        className="new-message-contact__avatar"
        style={{ background: peerColor(username) }}
        aria-hidden="true"
      >
        {username[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="new-message-contact__username">{username}</span>
      {subtitle ? <span className="new-message-contact__handle">{subtitle}</span> : (
        <span className="new-message-contact__handle">@{username}</span>
      )}
    </button>
  )
}

export function NewMessagePanel({ chatList }: NewMessagePanelProps) {
  const { sessionToken } = useAppContext()
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [allUsers, setAllUsers] = useState<{ id: string; username: string }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    setQuery('')
    setHighlightedIndex(0)
  }, [])

  // Fetch all server members once
  useEffect(() => {
    if (!sessionToken) return
    listUsers(sessionToken).then((res) => setAllUsers(res.users)).catch(() => {})
  }, [sessionToken])

  const normalizedQuery = query.trim().toLowerCase()

  // Merge recent contacts + all server users, deduplicated, with recent contacts first
  const suggestions = (() => {
    const recentUsernames = new Set(chatList.recentContacts.map((c) => c.username.toLowerCase()))

    // If no query, show recent contacts only
    if (!normalizedQuery) {
      return chatList.recentContacts.map((c) => ({
        username: c.username,
        isRecent: true,
      }))
    }

    // Filter recent contacts matching query
    const recentMatches = chatList.recentContacts
      .filter((c) => c.username.toLowerCase().includes(normalizedQuery))
      .map((c) => ({ username: c.username, isRecent: true }))

    // Filter all users matching query, excluding those already in recent matches
    const userMatches = allUsers
      .filter(
        (u) =>
          u.username.toLowerCase().includes(normalizedQuery) &&
          !recentUsernames.has(u.username.toLowerCase())
      )
      .map((u) => ({ username: u.username, isRecent: false }))

    return [...recentMatches, ...userMatches]
  })()

  // Show "new contact" row when query doesn't match any user exactly
  const exactMatch = suggestions.some(
    (s) => s.username.toLowerCase() === normalizedQuery
  )
  const showNewContactRow = normalizedQuery.length > 0 && !exactMatch

  const totalRows = suggestions.length + (showNewContactRow ? 1 : 0)

  useEffect(() => {
    setHighlightedIndex(0)
  }, [query])

  const selectHighlighted = useCallback(() => {
    if (highlightedIndex < suggestions.length) {
      void chatList.startDirectChatWith(suggestions[highlightedIndex].username)
    } else if (showNewContactRow && normalizedQuery) {
      void chatList.startDirectChatWith(normalizedQuery)
    }
  }, [highlightedIndex, suggestions, showNewContactRow, normalizedQuery, chatList])

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.min(i + 1, totalRows - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      selectHighlighted()
    }
  }

  return (
    <div className="new-message-panel">
      <div className="new-message-panel__search-row">
        <span className="new-message-panel__to">To:</span>
        <span className="new-message-panel__search-icon"><SearchIcon width={14} height={14} /></span>
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="new-message-panel__input"
          placeholder="Search members"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search members"
        />
      </div>

      <div className="new-message-panel__list" role="listbox" aria-label="Members">
        {suggestions.length === 0 && !showNewContactRow && normalizedQuery && (
          <p className="new-message-panel__empty">No members found</p>
        )}

        {suggestions.length === 0 && !normalizedQuery && (
          <p className="new-message-panel__empty">Type to search members</p>
        )}

        {suggestions.map((contact, i) => (
          <ContactRow
            key={contact.username}
            username={contact.username}
            highlighted={highlightedIndex === i}
            onClick={() => void chatList.startDirectChatWith(contact.username)}
          />
        ))}

        {showNewContactRow && (
          <button
            type="button"
            className={`new-message-contact new-message-contact--new${
              highlightedIndex === suggestions.length ? ' new-message-contact--highlighted' : ''
            }`}
            onClick={() => void chatList.startDirectChatWith(normalizedQuery)}
          >
            <span className="new-message-contact__avatar new-message-contact__avatar--new" aria-hidden="true">+</span>
            <span className="new-message-contact__username">
              Start chat with <strong>{query.trim()}</strong>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
