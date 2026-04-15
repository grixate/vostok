import { useUIContext } from '../../contexts/UIContext.tsx'
import type { useAuth } from '../../hooks/useAuth.ts'
import type { useChatSessions } from '../../hooks/useChatSessions.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import { t } from '../../lib/i18n.ts'
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
          <span className="settings-overlay__title">{t('settings')}</span>
          <button className="profile-overlay__close" type="button" onClick={() => setSettingsOverlayOpen(false)} aria-label={t('close')}>
            <CloseSmallIcon />
          </button>
        </div>

        <div className="settings-overlay__section">
          <div className="settings-overlay__section-title">{t('theme')}</div>
          <div style={{ padding: '0 8px 8px' }}>
            <ThemePicker />
          </div>
        </div>

        <div className="settings-overlay__section">
          <div className="settings-overlay__section-title">{t('session')}</div>
          <button className="settings-overlay__row" type="button" onClick={() => { setSettingsOverlayOpen(false); auth.handleReauthenticate() }}>
            <RefreshIcon width={18} height={18} />
            {t('refresh_session')}
          </button>
          <button className="settings-overlay__row" type="button" disabled>
            <LinkIcon width={18} height={18} />
            {t('link_device')}
          </button>
        </div>

        {chatSessions.safetyNumbers.length > 0 ? (
          <div className="settings-overlay__section">
            <div className="settings-overlay__section-title">{t('encryption')}</div>
            {chatSessions.safetyNumbers.map((entry) => (
              <div className="settings-overlay__row settings-overlay__row--info" key={entry.peerDeviceId}>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 13 }}>{entry.label}</strong>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', display: 'block', color: 'var(--label2)', marginTop: 2 }}>{entry.fingerprint}</span>
                </div>
                {!entry.verified ? (
                  <button className="mini-action" disabled={chatSessions.verifyingSafetyDeviceId === entry.peerDeviceId} onClick={() => void chatSessions.handleVerifyPeerSafetyNumber(entry.peerDeviceId, chatList.activeChatId)} type="button">{t('verify')}</button>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>{'\u2713'} {t('verified')}</span>
                )}
              </div>
            ))}
          </div>
        ) : null}

        <div className="settings-overlay__section">
          <button className="settings-overlay__row settings-overlay__row--danger" type="button" onClick={() => { setSettingsOverlayOpen(false); auth.handleForgetDevice() }}>
            <SignOutIcon width={18} height={18} />
            {t('sign_out')}
          </button>
        </div>
      </div>
    </>
  )
}
