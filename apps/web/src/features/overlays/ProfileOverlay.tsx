import { useUIContext } from '../../contexts/UIContext.tsx'
import type { useAuth } from '../../hooks/useAuth.ts'
import {
  CloseSmallIcon,
  SettingsIcon,
  SignOutIcon,
} from '../../icons/index.tsx'

type ProfileOverlayProps = {
  auth: ReturnType<typeof useAuth>
}

export function ProfileOverlay({ auth }: ProfileOverlayProps) {
  const {
    profileOverlayOpen,
    setProfileOverlayOpen,
    setSettingsOverlayOpen
  } = useUIContext()

  return (
    <>
      <div
        className={profileOverlayOpen ? 'overlay-backdrop overlay-backdrop--visible' : 'overlay-backdrop'}
        onClick={() => setProfileOverlayOpen(false)}
        aria-hidden={!profileOverlayOpen}
      />
      <div className={profileOverlayOpen ? 'profile-overlay profile-overlay--visible' : 'profile-overlay'}>
        <div className="profile-overlay__header">
          <div className="profile-overlay__avatar" style={{ background: 'var(--accent)' }}>
            {(auth.profileUsername ?? 'U').slice(0, 1)}
          </div>
          <div className="profile-overlay__info">
            <strong>{auth.profileUsername ?? 'User'}</strong>
            <span>@{auth.profileUsername ?? 'user'}</span>
          </div>
          <button className="profile-overlay__close" type="button" onClick={() => setProfileOverlayOpen(false)} aria-label="Close">
            <CloseSmallIcon />
          </button>
        </div>
        <div className="profile-overlay__actions">
          <button type="button" onClick={() => { setProfileOverlayOpen(false); setSettingsOverlayOpen(true) }}>
            <SettingsIcon width={18} height={18} />
            Settings
          </button>
          <div className="profile-overlay__sep" />
          <button type="button" className="profile-overlay__danger" onClick={() => { setProfileOverlayOpen(false); auth.handleForgetDevice() }}>
            <SignOutIcon width={18} height={18} />
            Sign Out
          </button>
        </div>
      </div>
    </>
  )
}
