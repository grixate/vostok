import { useState, useEffect } from 'react'
import type { useAuth } from '../../hooks/useAuth.ts'
import type { useChatSessions } from '../../hooks/useChatSessions.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import { ThemePicker } from './ThemePicker.tsx'
import {
  BackIcon,
  RefreshIcon,
  LinkIcon,
  SignOutIcon,
  NotificationsIcon,
  ShieldIcon,
  LockIcon,
  AdvancedIcon,
} from '../../icons/index.tsx'

type Section = 'chat-settings' | 'privacy' | 'notifications' | 'advanced'

type SettingsPaneProps = {
  auth: ReturnType<typeof useAuth>
  chatSessions: ReturnType<typeof useChatSessions>
  chatList: ReturnType<typeof useChatList>
  onClose: () => void
}

const SECTION_TITLES: Record<Section, string> = {
  'chat-settings': 'Chat Settings',
  'privacy': 'Privacy & Security',
  'notifications': 'Notifications',
  'advanced': 'Advanced',
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`settings-pane__nav-item${active ? ' settings-pane__nav-item--active' : ''}`}
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      <span className="settings-pane__nav-icon">{icon}</span>
      <span className="settings-pane__nav-label">{label}</span>
    </button>
  )
}

export function SettingsPane({ auth, chatSessions, chatList, onClose }: SettingsPaneProps) {
  const [activeSection, setActiveSection] = useState<Section>('chat-settings')

  // useKeyboardShortcuts handles Escape only for blur/banner clearing — it does not
  // close the settings pane. Capture it here at the component level.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const profileInitial = auth.profileUsername?.[0]?.toUpperCase() ?? '?'

  return (
    <div className="settings-pane">
      {/* ─── Left navigation ─────────────────────────────────────────────────── */}
      <aside className="settings-pane__nav">
        <div className="settings-pane__profile">
          <div className="settings-pane__profile-avatar">{profileInitial}</div>
          <div className="settings-pane__profile-info">
            <strong className="settings-pane__profile-name">{auth.profileUsername ?? 'Unknown'}</strong>
            <span className="settings-pane__profile-handle">@{auth.profileUsername ?? ''}</span>
          </div>
        </div>

        <nav className="settings-pane__nav-list" aria-label="Settings sections">
          <NavItem
            icon={<NotificationsIcon width={18} height={18} />}
            label="Notifications"
            active={activeSection === 'notifications'}
            onClick={() => setActiveSection('notifications')}
          />
          <NavItem
            icon={<ShieldIcon width={18} height={18} />}
            label="Privacy & Security"
            active={activeSection === 'privacy'}
            onClick={() => setActiveSection('privacy')}
          />
          <NavItem
            icon={<LockIcon width={18} height={18} />}
            label="Chat Settings"
            active={activeSection === 'chat-settings'}
            onClick={() => setActiveSection('chat-settings')}
          />
          <NavItem
            icon={<AdvancedIcon width={18} height={18} />}
            label="Advanced"
            active={activeSection === 'advanced'}
            onClick={() => setActiveSection('advanced')}
          />
        </nav>

        <div className="settings-pane__nav-footer">
          <button
            className="settings-pane__sign-out"
            type="button"
            onClick={() => { onClose(); auth.handleForgetDevice() }}
          >
            <SignOutIcon width={18} height={18} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ─── Main content ─────────────────────────────────────────────────────── */}
      <div className="settings-pane__content">
        <div className="settings-pane__header">
          <button
            className="settings-pane__back"
            type="button"
            onClick={onClose}
            aria-label="Back to chats"
          >
            <BackIcon />
          </button>
          <span className="settings-pane__title">{SECTION_TITLES[activeSection]}</span>
        </div>

        <div className="settings-pane__body">

          {/* ── Chat Settings ─────────────────────────────────────────────────── */}
          {activeSection === 'chat-settings' && (
            <div className="settings-section">
              {/* ThemePicker renders its own section titles — no wrapper title needed */}
              <div className="settings-section__theme-wrap">
                <ThemePicker />
              </div>
            </div>
          )}

          {/* ── Privacy & Security ────────────────────────────────────────────── */}
          {activeSection === 'privacy' && (
            <div className="settings-section">
              <div className="settings-section__group">
                <div className="settings-section__group-title">Session</div>
                <button
                  className="settings-section__row"
                  type="button"
                  onClick={() => { onClose(); auth.handleReauthenticate() }}
                >
                  <RefreshIcon width={18} height={18} />
                  Refresh Session
                </button>
                <button
                  className="settings-section__row"
                  type="button"
                  onClick={() => { onClose(); auth.setView('link') }}
                >
                  <LinkIcon width={18} height={18} />
                  Link Another Device
                </button>
              </div>

              {chatSessions.safetyNumbers.length > 0 ? (
                <div className="settings-section__group">
                  <div className="settings-section__group-title">Encryption</div>
                  {chatSessions.safetyNumbers.map((entry) => (
                    <div
                      className="settings-section__row settings-section__row--info"
                      key={entry.peerDeviceId}
                    >
                      <div style={{ flex: 1 }}>
                        <strong style={{ fontSize: 13 }}>{entry.label}</strong>
                        <span
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            wordBreak: 'break-all',
                            display: 'block',
                            color: 'var(--label2)',
                            marginTop: 2,
                          }}
                        >
                          {entry.fingerprint}
                        </span>
                      </div>
                      {!entry.verified ? (
                        <button
                          className="mini-action"
                          disabled={chatSessions.verifyingSafetyDeviceId === entry.peerDeviceId}
                          onClick={() => {
                            if (!chatList.activeChatId) return
                            void chatSessions.handleVerifyPeerSafetyNumber(
                              entry.peerDeviceId,
                              chatList.activeChatId
                            )
                          }}
                          type="button"
                        >
                          Verify
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>
                          ✓ Verified
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* ── Notifications ─────────────────────────────────────────────────── */}
          {activeSection === 'notifications' && (
            <div className="settings-section">
              <div className="settings-section__group">
                <div className="settings-section__group-title">Notifications</div>
                <p className="settings-section__empty">
                  Notification preferences will appear here. Grant notification permission
                  to receive alerts when new messages arrive.
                </p>
              </div>
            </div>
          )}

          {/* ── Advanced ──────────────────────────────────────────────────────── */}
          {activeSection === 'advanced' && (
            <div className="settings-section">
              <div className="settings-section__group">
                <div className="settings-section__group-title">About</div>
                <div className="settings-section__row settings-section__row--info">
                  <span>App Version</span>
                  <span style={{ color: 'var(--label2)', fontSize: 13 }}>0.7.0</span>
                </div>
              </div>
              <div className="settings-section__group">
                <div className="settings-section__group-title">Data</div>
                <button
                  className="settings-section__row"
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('vostok.layout.sidebar_width')
                    window.location.reload()
                  }}
                >
                  Reset Layout Preferences
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
