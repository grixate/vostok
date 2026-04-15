import { useState, useEffect } from 'react'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { fetchCallHistory, listUsers } from '../../lib/api.ts'
import type { CallHistoryEntry as ApiCallHistoryEntry } from '../../lib/api.ts'
import { PhoneIcon, PhoneCallIcon } from '../../icons/index.tsx'
import { ParticipantPicker } from './ParticipantPicker.tsx'
import type { useCall } from '../../hooks/useCall.ts'
import { t } from '../../lib/i18n.ts'

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
  call?: ReturnType<typeof useCall>
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
    if (days === 0) return t('today')
    if (days === 1) return t('yesterday')
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

function formatDuration(startedAt: string | null, endedAt: string | null): string | null {
  if (!startedAt || !endedAt) return null
  const seconds = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  if (seconds < 0) return null
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function mapApiCall(call: ApiCallHistoryEntry, localDeviceId: string | null): CallHistoryEntry {
  const isOutgoing = localDeviceId ? call.started_by_device_id === localDeviceId : true
  const wasMissed = call.ended_at != null && call.started_at != null &&
    (new Date(call.ended_at).getTime() - new Date(call.started_at).getTime()) < 3000 &&
    !isOutgoing

  return {
    id: call.id,
    type: (call.mode === 'group'
      ? 'group'
      : call.media_mode === 'video' || call.mode === 'video'
        ? 'video'
        : 'voice') as 'voice' | 'video' | 'group',
    contactName: call.display_title,
    contactInitial: call.display_title.slice(0, 1),
    direction: isOutgoing ? 'outgoing' : 'incoming',
    missed: wasMissed,
    duration: formatDuration(call.started_at, call.ended_at),
    timestamp: call.started_at ?? call.ended_at ?? '',
  }
}

export function CallsTab({ onStartCall, call }: CallsTabProps) {
  const { sessionToken, storedDevice } = useAppContext()
  const [entries, setEntries] = useState<CallHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [directoryUsers, setDirectoryUsers] = useState<Array<{ id: string; username: string }>>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const callingUnavailable = (call?.callCapabilityState !== 'supported') || !(call?.isCallSessionReady ?? Boolean(sessionToken && storedDevice))
  const callingUnavailableReason = !call?.isCallSessionReady && sessionToken
    ? 'Calls are still loading for this account.'
    : (call?.callCapabilityReason ?? 'Calls are unavailable on this browser.')

  useEffect(() => {
    if (!sessionToken) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
    }, 0)

    fetchCallHistory(sessionToken)
      .then((response) => {
        if (cancelled) return
        const localDeviceId = storedDevice?.deviceId ?? null
        setEntries(response.calls.map((c) => mapApiCall(c, localDeviceId)))
      })
      .catch(() => {
        // Silently fail — show empty state
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [sessionToken, storedDevice?.deviceId])

  useEffect(() => {
    if (!sessionToken || !pickerOpen) return

    listUsers(sessionToken)
      .then((response) => setDirectoryUsers(response.users))
      .catch(() => setDirectoryUsers([]))
  }, [pickerOpen, sessionToken])

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
          <span className="sidebar__title">{t('calls')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {call ? (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: callingUnavailable ? 'not-allowed' : 'pointer',
                  color: callingUnavailable ? 'var(--text-secondary)' : 'var(--accent)',
                  display: 'flex',
                  padding: 4
                }}
                aria-label={t('new_group_call')}
                title={callingUnavailable ? callingUnavailableReason : t('new_group_call')}
                disabled={callingUnavailable}
              >
                <PhoneCallIcon width={20} height={20} />
              </button>
            ) : null}
            {onStartCall && (
              <button
                type="button"
                onClick={() => onStartCall('voice')}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: callingUnavailable ? 'not-allowed' : 'pointer',
                  color: callingUnavailable ? 'var(--text-secondary)' : 'var(--accent)',
                  display: 'flex',
                  padding: 4
                }}
                aria-label={t('new_call')}
                title={callingUnavailable ? callingUnavailableReason : t('new_call')}
                disabled={callingUnavailable}
              >
                <PhoneIcon width={20} height={20} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Call list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div className="empty-state" style={{ flex: 1 }}>
            <span className="message-thread__loading-spinner" />
          </div>
        ) : entries.length === 0 ? (
          <div className="empty-state" style={{ flex: 1 }}>
            <div className="empty-state__icon">
              <PhoneIcon width={28} height={28} />
            </div>
            <p className="empty-state__title">{t('no_calls_yet')}</p>
            <p className="empty-state__body">{t('no_calls_subtitle')}</p>
            {onStartCall && (
              <button
                className="primary-action empty-state__action"
                type="button"
                onClick={() => onStartCall('voice')}
                disabled={callingUnavailable}
                title={callingUnavailable ? callingUnavailableReason : t('start_a_call')}
              >
                {t('start_a_call')}
              </button>
            )}
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
                        <span>{t('call_missed')}</span>
                      ) : (
                        <span>
                          {entry.type === 'video' ? t('video_call') : entry.type === 'group' ? t('group_call') : t('voice_call')}
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
      {pickerOpen && call ? (
        <ParticipantPicker
          members={directoryUsers.map((user) => ({
            userId: user.id,
            username: user.username
          }))}
          onClose={() => setPickerOpen(false)}
          onStartCall={(participantIds, mode) => {
            void call.handleStartAdHocCall(participantIds, mode)
            setPickerOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}
