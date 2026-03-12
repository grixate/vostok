import type { useAuth } from '../../hooks/useAuth.ts'

type LoginFlowProps = {
  auth: ReturnType<typeof useAuth>
}

export function LoginFlow({ auth }: LoginFlowProps) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-card__logo">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <circle cx="28" cy="28" r="28" fill="var(--accent)" />
            <text x="28" y="34" textAnchor="middle" fill="white" fontSize="24" fontWeight="700">V</text>
          </svg>
        </div>
        <h1 className="auth-card__title">Vostok</h1>
        <p className="auth-card__subtitle">Secure messaging for everyone</p>

        <div className="auth-card__tabs">
          <button
            className={auth.view === 'register' || auth.view === 'welcome' ? 'auth-tab auth-tab--active' : 'auth-tab'}
            type="button"
            onClick={() => auth.setView('register')}
          >
            Register
          </button>
          <button
            className={auth.view === 'login' ? 'auth-tab auth-tab--active' : 'auth-tab'}
            type="button"
            onClick={() => auth.setView('login')}
          >
            Sign In
          </button>
          <button
            className={auth.view === 'link' ? 'auth-tab auth-tab--active' : 'auth-tab'}
            type="button"
            onClick={() => auth.setView('link')}
          >
            Link
          </button>
        </div>

        {/* Banner is accessed from context */}
        {auth.view === 'welcome' || auth.view === 'register' ? (
          <form className="auth-form" onSubmit={auth.handleRegister}>
            <label className="auth-field">
              <span>Username</span>
              <input
                autoComplete="username"
                onChange={(event) => auth.setUsername(event.target.value)}
                placeholder="Choose a username"
                required
                value={auth.username}
              />
            </label>

            <label className="auth-field">
              <span>Device name</span>
              <input
                onChange={(event) => auth.setDeviceName(event.target.value)}
                placeholder="e.g. Safari on Mac"
                required
                value={auth.deviceName}
              />
            </label>

            <button className="primary-action" type="submit">
              Create Account
            </button>
          </form>
        ) : null}

        {auth.view === 'login' ? (
          <div className="auth-form">
            <button
              className="primary-action"
              onClick={auth.handleReauthenticate}
              type="button"
            >
              Sign In
            </button>
          </div>
        ) : null}

        {auth.view === 'link' ? (
          <div className="auth-form">
            <label className="auth-field">
              <span>Pairing code</span>
              <input disabled placeholder="Coming soon" value="" readOnly />
            </label>

            <button className="secondary-action" disabled type="button">
              Link Device
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
