import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { SearchIcon } from '../../icons/index.tsx'
import type { useChatList } from '../../hooks/useChatList.ts'

type NewMessagePanelProps = {
  chatList: ReturnType<typeof useChatList>
}

function avatarColor(username: string): string {
  const colors = ['#5C7CFF', '#FF6B6B', '#51CF66', '#FF922B', '#CC5DE8', '#22B8CF', '#F06595']
  let hash = 0
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function ContactRow({
  username,
  highlighted,
  onClick,
}: {
  username: string
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
        style={{ background: avatarColor(username) }}
        aria-hidden="true"
      >
        {username[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="new-message-contact__username">{username}</span>
      <span className="new-message-contact__handle">@{username}</span>
    </button>
  )
}

export function NewMessagePanel({ chatList }: NewMessagePanelProps) {
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Autofocus when panel mounts
    inputRef.current?.focus()
    setQuery('')
    setHighlightedIndex(0)
  }, [])

  const normalizedQuery = query.trim().toLowerCase()

  const filteredContacts = normalizedQuery
    ? chatList.recentContacts.filter((c) => c.username.toLowerCase().includes(normalizedQuery))
    : chatList.recentContacts

  // Append a "new contact" row when query doesn't match an existing contact exactly
  const exactMatch = chatList.recentContacts.some(
    (c) => c.username.toLowerCase() === normalizedQuery
  )
  const showNewContactRow = normalizedQuery.length > 0 && !exactMatch

  const totalRows = filteredContacts.length + (showNewContactRow ? 1 : 0)

  useEffect(() => {
    setHighlightedIndex(0)
  }, [query])

  const selectHighlighted = useCallback(() => {
    if (highlightedIndex < filteredContacts.length) {
      void chatList.startDirectChatWith(filteredContacts[highlightedIndex].username)
    } else if (showNewContactRow && normalizedQuery) {
      void chatList.startDirectChatWith(normalizedQuery)
    }
  }, [highlightedIndex, filteredContacts, showNewContactRow, normalizedQuery, chatList])

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
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search contacts"
        />
      </div>

      <div className="new-message-panel__list" role="listbox" aria-label="Contacts">
        {filteredContacts.length === 0 && !showNewContactRow && (
          <p className="new-message-panel__empty">No recent contacts</p>
        )}

        {filteredContacts.map((contact, i) => (
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
              highlightedIndex === filteredContacts.length ? ' new-message-contact--highlighted' : ''
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
