import { useUIContext } from '../../contexts/UIContext.tsx'
import type { useAuth } from '../../hooks/useAuth.ts'
import type { useChatSessions } from '../../hooks/useChatSessions.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import { ThemePicker } from '../settings/ThemePicker.tsx'
import {
  CloseSmallIcon,
  RefreshIcon,
  LinkIcon,
  SignOutIcon,
} from '../../icons/index.tsx'

type SettingsOverlayProps = {
  auth: ReturnType<typeof useAuth>
  chatSessions: ReturnType<typeof useChatSessions>
  chatList: ReturnType<typeof useChatList>
}

export function SettingsOverlay({ auth, chatSessions, chatList }: SettingsOverlayProps) {
  const {
    settingsOverlayOpen,
    setSettingsOverlayOpen
  } = useUIContext()

  return (
    <>
      <div
        className={settingsOverlayOpen ? 'overlay-backdrop overlay-backdrop--visible' : 'overlay-backdrop'}
        onClick={() => setSettingsOverlayOpen(false)}
        aria-hidden={!settingsOverlayOpen}
      />
      <div className={settingsOverlayOpen ? 'profile-overlay settings-overlay profile-overlay--visible' : 'profile-overlay settings-overlay'}>
        <div className="profile-overlay__header">
          <span className="settings-overlay__title">Settings</span>
          <button className="profile-overlay__close" type="button" onClick={() => setSettingsOverlayOpen(false)} aria-label="Close">
            <CloseSmallIcon />
          </button>
        </div>

        <div className="settings-overlay__section">
          <div className="settings-overlay__section-title">Theme</div>
          <div style={{ padding: '0 8px 8px' }}>
            <ThemePicker />
          </div>
        </div>

        <div className="settings-overlay__section">
          <div className="settings-overlay__section-title">Session</div>
          <button className="settings-overlay__row" type="button" onClick={() => { setSettingsOverlayOpen(false); auth.handleReauthenticate() }}>
            <RefreshIcon width={18} height={18} />
            Refresh Session
          </button>
          <button className="settings-overlay__row" type="button" onClick={() => { setSettingsOverlayOpen(false); auth.setView('link') }}>
            <LinkIcon width={18} height={18} />
            Link Another Device
          </button>
        </div>

        {chatSessions.safetyNumbers.length > 0 ? (
          <div className="settings-overlay__section">
            <div className="settings-overlay__section-title">Encryption</div>
            {chatSessions.safetyNumbers.map((entry) => (
              <div className="settings-overlay__row settings-overlay__row--info" key={entry.peerDeviceId}>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 13 }}>{entry.label}</strong>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', display: 'block', color: 'var(--label2)', marginTop: 2 }}>{entry.fingerprint}</span>
                </div>
                {!entry.verified ? (
                  <button className="mini-action" disabled={chatSessions.verifyingSafetyDeviceId === entry.peerDeviceId} onClick={() => void chatSessions.handleVerifyPeerSafetyNumber(entry.peerDeviceId, chatList.activeChatId)} type="button">Verify</button>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>{'\u2713'} Verified</span>
                )}
              </div>
            ))}
          </div>
        ) : null}

        <div className="settings-overlay__section">
          <button className="settings-overlay__row settings-overlay__row--danger" type="button" onClick={() => { setSettingsOverlayOpen(false); auth.handleForgetDevice() }}>
            <SignOutIcon width={18} height={18} />
            Sign Out
          </button>
        </div>
      </div>
    </>
  )
}
