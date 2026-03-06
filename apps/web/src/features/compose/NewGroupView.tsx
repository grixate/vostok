import { useState, type KeyboardEvent } from 'react'
import type { NavigationStack, AppScreen } from '../../shared/hooks/useNavigation'

interface Props {
  nav: NavigationStack<AppScreen>
  loading: boolean
  onCreateGroup: (title: string, members: string[]) => void
}

export function NewGroupView({ nav, loading, onCreateGroup }: Props) {
  const [title, setTitle] = useState('')
  const [memberInput, setMemberInput] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  function addMember(raw: string) {
    const name = raw.trim().toLowerCase()
    if (!name) return
    if (members.includes(name)) {
      setError(`${name} is already added.`)
      return
    }
    setMembers((prev) => [...prev, name])
    setMemberInput('')
    setError(null)
  }

  function handleMemberKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addMember(memberInput)
    } else if (e.key === 'Backspace' && memberInput === '' && members.length > 0) {
      setMembers((prev) => prev.slice(0, -1))
    }
  }

  function removeMember(name: string) {
    setMembers((prev) => prev.filter((m) => m !== name))
  }

  function handleCreate() {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('Group name is required.')
      return
    }
    // Add any pending input as a member too
    const pendingMember = memberInput.trim()
    const finalMembers = pendingMember
      ? [...new Set([...members, pendingMember.toLowerCase()])]
      : members
    onCreateGroup(trimmedTitle, finalMembers)
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
          disabled={loading}
        >
          ←
        </button>
        <h2 className="sidebar-view__title">New Group</h2>
      </div>

      <div className="sidebar-view__form">
        <label className="sidebar-view__field">
          <span className="sidebar-view__field-label">Group name</span>
          <input
            autoFocus
            className="sidebar-view__input"
            disabled={loading}
            maxLength={64}
            onChange={(e) => {
              setTitle(e.target.value)
              setError(null)
            }}
            placeholder="e.g. Operations"
            value={title}
          />
        </label>

        <div className="sidebar-view__field">
          <span className="sidebar-view__field-label">Add members</span>
          <div className="member-chips">
            {members.map((m) => (
              <span key={m} className="member-chip">
                {m}
                <button
                  className="member-chip__remove"
                  type="button"
                  onClick={() => removeMember(m)}
                  aria-label={`Remove ${m}`}
                  disabled={loading}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              className="member-chips__input"
              disabled={loading}
              onChange={(e) => setMemberInput(e.target.value)}
              onKeyDown={handleMemberKeyDown}
              onBlur={() => addMember(memberInput)}
              placeholder={members.length === 0 ? 'username, username…' : ''}
              value={memberInput}
            />
          </div>
          <span className="sidebar-view__field-hint">Press Enter or comma to add each member.</span>
        </div>

        {error ? <span className="onboarding-field-error">{error}</span> : null}

        <button
          className="primary-action sidebar-view__create-btn"
          disabled={loading || title.trim() === ''}
          onClick={handleCreate}
          type="button"
        >
          {loading ? 'Creating…' : 'Create Group'}
        </button>
      </div>
    </div>
  )
}
