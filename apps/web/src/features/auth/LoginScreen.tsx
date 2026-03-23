import { useState, type FormEvent } from 'react'
import { Zap, User, Lock, Eye, EyeOff } from 'lucide-react'
import type { AuthView, ServerInfo } from '../../types.ts'

type Props = {
  serverInfo: ServerInfo | null
  error: string | null
  loading: boolean
  onLogin: (username: string, password: string) => void
  onDevQuickLogin: (username: string) => void
  onNavigate: (view: AuthView) => void
}

function generateDevUsername(): string {
  const n = Math.floor(1000 + Math.random() * 9000)
  return `dev_user_${n}`
}

export function LoginScreen({ serverInfo, error, loading, onLogin, onDevQuickLogin, onNavigate }: Props) {
  const isDevMode = serverInfo?.auth_mode === 'dev'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState(isDevMode ? 'password' : '')
  const [showPassword, setShowPassword] = useState(false)

  const serverUrl = window.location.host
  const hasError = !!error

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    onLogin(username, password)
  }

  function handleDevQuickLogin() {
    const name = username || generateDevUsername()
    onDevQuickLogin(name)
  }

  return (
    <div className="auth-shell">
      {isDevMode && (
        <div className="auth-dev-banner">
          <span>⚠ DEV MODE — Open registration enabled. Do not use in production.</span>
        </div>
      )}
      <div className="auth-card">
        <div className="auth-card__logo">
          <Zap size={40} color="var(--accent)" strokeWidth={1.75} />
        </div>
        <h1 className="auth-card__title">Vostok</h1>
        <p className="auth-card__subtitle">{serverInfo?.name ?? serverUrl}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className={`auth-input-row${hasError ? ' auth-input-row--error' : ''}`}>
            <User size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              autoComplete="username"
              placeholder="Username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
            {isDevMode && (
              <button
                type="button"
                className="auth-random-btn"
                onClick={() => setUsername(generateDevUsername())}
                tabIndex={-1}
              >
                Random
              </button>
            )}
          </div>

          <div className={`auth-input-row${hasError ? ' auth-input-row--error' : ''}`}>
            <Lock size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            <button
              type="button"
              className="auth-eye-toggle"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword
                ? <EyeOff size={18} strokeWidth={1.75} />
                : <Eye size={18} strokeWidth={1.75} />}
            </button>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-btn-primary" type="submit" disabled={loading}>
            {loading ? <span className="auth-spinner" /> : 'Sign In'}
          </button>
        </form>

        <button
          className="auth-link auth-link--accent"
          type="button"
          onClick={() => onNavigate('forgot-password')}
        >
          Forgot password?
        </button>

        <div className="auth-divider">
          <span />
          <span>or</span>
          <span />
        </div>

        <button
          className="auth-link auth-link--accent"
          type="button"
          onClick={() => onNavigate('invite-code')}
        >
          I have an invite code
        </button>

        {isDevMode && (
          <button
            className="auth-link auth-link--warning"
            type="button"
            disabled={loading}
            onClick={handleDevQuickLogin}
          >
            Create Dev Account
          </button>
        )}

        {serverInfo?.access_requests_enabled && (
          <button
            className="auth-link auth-link--muted"
            type="button"
            onClick={() => onNavigate('access-request')}
          >
            Request Access
          </button>
        )}
      </div>
    </div>
  )
}
