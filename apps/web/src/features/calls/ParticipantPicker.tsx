import { useState } from 'react'
import { SearchIcon, CloseIcon, PhoneCallIcon } from '../../icons/index.tsx'

type Member = {
  userId: string
  username: string
  displayName?: string
}

type ParticipantPickerProps = {
  members: Member[]
  onStartCall: (participantIds: string[], mode: 'voice' | 'video') => void
  onClose: () => void
}

export function ParticipantPicker({ members, onStartCall, onClose }: ParticipantPickerProps) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const filtered = members.filter((m) => {
    const q = search.toLowerCase()
    return m.username.toLowerCase().includes(q) || (m.displayName ?? '').toLowerCase().includes(q)
  })

  function toggleMember(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-overlay__card" style={{ maxWidth: 400, padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', gap: 12, borderBottom: '1px solid var(--border-subtle)', width: '100%' }}>
          <span style={{ fontSize: 17, fontWeight: 510, flex: 1 }}>Start Group Call</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}>
            <CloseIcon width={20} height={20} />
          </button>
        </div>

        <div style={{ padding: '12px 16px', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface-1)', borderRadius: 20, padding: '0 12px', height: 36 }}>
            <SearchIcon width={16} height={16} />
            <input
              type="text"
              placeholder="Search members..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ border: 'none', background: 'none', outline: 'none', flex: 1, fontSize: 14, color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div style={{ maxHeight: 300, overflowY: 'auto', width: '100%' }}>
          {filtered.map((m) => (
            <button
              key={m.userId}
              type="button"
              onClick={() => toggleMember(m.userId)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-primary)', fontSize: 14,
              }}
            >
              <span style={{
                width: 20, height: 20, borderRadius: 4,
                border: selected.has(m.userId) ? 'none' : '2px solid var(--text-secondary)',
                background: selected.has(m.userId) ? 'var(--accent)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontSize: 12, flexShrink: 0,
              }}>
                {selected.has(m.userId) ? '✓' : null}
              </span>
              <span style={{ flex: 1, textAlign: 'left' }}>
                {m.displayName || m.username}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                @{m.username}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14 }}>
              No members found
            </div>
          )}
        </div>

        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 8, padding: '16px 20px', borderTop: '1px solid var(--border-subtle)', width: '100%' }}>
            <button
              type="button"
              onClick={() => onStartCall(Array.from(selected), 'voice')}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '10px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'var(--accent)', color: 'white', fontSize: 14, fontWeight: 510,
              }}
            >
              <PhoneCallIcon width={16} height={16} />
              Call ({selected.size})
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
