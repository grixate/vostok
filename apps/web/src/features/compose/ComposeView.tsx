import { useState } from 'react'
import type { NavigationStack, AppScreen } from '../../shared/hooks/useNavigation'

interface Contact {
  username: string
}

interface Props {
  nav: NavigationStack<AppScreen>
  contacts: Contact[]
  loading: boolean
  onStartChat: (username: string) => void
}

export function ComposeView({ nav, contacts, loading, onStartChat }: Props) {
  const [query, setQuery] = useState('')

  const filtered =
    query.trim() === ''
      ? contacts
      : contacts.filter((c) => c.username.toLowerCase().includes(query.trim().toLowerCase()))

  function handleSelect(username: string) {
    onStartChat(username)
    nav.reset('chat-list')
  }

  return (
    <div className="sidebar-view">
      <div className="sidebar-view__header">
        <button
          className="sidebar-view__back"
          type="button"
          onClick={() => nav.pop()}
          aria-label="Back"
        >
          ←
        </button>
        <h2 className="sidebar-view__title">New Message</h2>
      </div>

      <div className="sidebar-view__search">
        <input
          autoFocus
          className="sidebar-view__search-input"
          disabled={loading}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by username…"
          value={query}
        />
      </div>

      <div className="sidebar-view__list">
        {/* New Group always appears at top */}
        <button
          className="sidebar-view__row sidebar-view__row--action"
          type="button"
          onClick={() => nav.push('new-group')}
        >
          <span className="sidebar-view__row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="2" />
              <circle cx="15" cy="7" r="3" stroke="currentColor" strokeWidth="2" />
              <path
                d="M3 19c0-3.314 2.686-6 6-6h6c3.314 0 6 2.686 6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path d="M19 11v4M17 13h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="sidebar-view__row-label">New Group</span>
          <span className="sidebar-view__row-chevron" aria-hidden="true">›</span>
        </button>

        <div className="sidebar-view__section-label">Contacts</div>

        {filtered.length > 0 ? (
          filtered.map((contact) => (
            <button
              key={contact.username}
              className="sidebar-view__row"
              type="button"
              onClick={() => handleSelect(contact.username)}
              disabled={loading}
            >
              <span className="sidebar-view__row-avatar" aria-hidden="true">
                {contact.username[0]?.toUpperCase() ?? '?'}
              </span>
              <span className="sidebar-view__row-label">{contact.username}</span>
            </button>
          ))
        ) : (
          <span className="sidebar-view__empty">
            {query.trim() === '' ? 'No contacts yet.' : `No match for "${query}"`}
          </span>
        )}
      </div>
    </div>
  )
}
