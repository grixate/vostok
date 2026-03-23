import { useState, useEffect } from 'react'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { PhoneIcon, VideoIcon, PhoneCallIcon } from '../../icons/index.tsx'

type CallHistoryEntry = {
  id: string
  type: 'voice' | 'video' | 'group'
  contactName: string
  contactInitial: string
  direction: 'outgoing' | 'incoming'
  missed: boolean
  duration: string | null
  timestamp: string
}

type CallsTabProps = {
  onStartCall?: (mode: 'voice' | 'video') => void
}

function formatCallTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function formatCallDate(isoString: string): string {
  try {
    const d = new Date(isoString)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export function CallsTab({ onStartCall }: CallsTabProps) {
  const { sessionToken } = useAppContext()
  const [entries] = useState<CallHistoryEntry[]>([])

  // TODO: fetch call history from server when endpoint is available
  useEffect(() => {
    if (!sessionToken) return
    // Future: fetchCallHistory(sessionToken).then(setEntries)
  }, [sessionToken])

  // Group entries by date
  const grouped = new Map<string, CallHistoryEntry[]>()
  for (const entry of entries) {
    const date = formatCallDate(entry.timestamp)
    const group = grouped.get(date) ?? []
    group.push(entry)
    grouped.set(date, group)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Header */}
      <div className="sidebar__header">
        <div className="sidebar__title-row">
          <span className="sidebar__title">Calls</span>
          {onStartCall && (
            <button
              type="button"
              onClick={() => onStartCall('voice')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', display: 'flex', padding: 4 }}
              aria-label="New call"
            >
              <PhoneCallIcon width={20} height={20} />
            </button>
          )}
        </div>
      </div>

      {/* Call list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {entries.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12, color: 'var(--text-secondary)' }}>
            <PhoneIcon width={40} height={40} />
            <span style={{ fontSize: 14 }}>No call history yet</span>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([date, calls]) => (
            <div key={date}>
              <div style={{ padding: '12px 20px 4px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {date}
              </div>
              {calls.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                    padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-primary)',
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: 'var(--gradient-button)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontSize: 15, fontWeight: 700, flexShrink: 0,
                  }}>
                    {entry.contactInitial}
                  </div>
                  <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 510,
                      color: entry.missed ? 'var(--danger)' : 'var(--text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {entry.contactName}
                    </div>
                    <div style={{ fontSize: 13, color: entry.missed ? 'var(--danger)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{entry.direction === 'outgoing' ? '↗' : '↙'}</span>
                      {entry.missed ? (
                        <span>Missed call</span>
                      ) : (
                        <span>
                          {entry.type === 'video' ? 'Video' : entry.type === 'group' ? 'Group' : 'Voice'} call
                          {entry.duration ? ` · ${entry.duration}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', flexShrink: 0 }}>
                    {formatCallTime(entry.timestamp)}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
