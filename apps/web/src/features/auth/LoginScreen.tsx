import { useState, type FormEvent } from 'react'
import { Zap, User, Lock, Eye, EyeOff } from 'lucide-react'
import type { AuthView, ServerInfo } from '../../types.ts'
import { t } from '../../lib/i18n.ts'

type Props = {
  serverInfo: ServerInfo | null
  serverUrl: string
  serverName: string | null
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

function formatServerHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function LoginScreen({
  serverInfo,
  serverUrl,
  serverName,
  error,
  loading,
  onLogin,
  onDevQuickLogin,
  onNavigate
}: Props) {
  const isDevMode = serverInfo?.auth_mode === 'dev'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState(isDevMode ? 'password' : '')
  const [showPassword, setShowPassword] = useState(false)

  const hasError = !!error
  const serverTitle = serverInfo?.name ?? serverName ?? formatServerHost(serverUrl)

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
          <span>⚠ {t('dev_mode_banner')}</span>
        </div>
      )}
      <div className="auth-card">
        <div className="auth-card__logo">
          <Zap size={40} color="var(--accent)" strokeWidth={1.75} />
        </div>
        <h1 className="auth-card__title">{t('vostok')}</h1>
        <p className="auth-card__subtitle">{serverTitle}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className={`auth-input-row${hasError ? ' auth-input-row--error' : ''}`}>
            <User size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              autoComplete="username"
              placeholder={t('username')}
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
                {t('random')}
              </button>
            )}
          </div>

          <div className={`auth-input-row${hasError ? ' auth-input-row--error' : ''}`}>
            <Lock size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder={t('password')}
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
            {loading ? <span className="auth-spinner" /> : t('login')}
          </button>
        </form>

        <button
          className="auth-link auth-link--accent"
          type="button"
          onClick={() => onNavigate('forgot-password')}
        >
          {t('forgot_password')}
        </button>

        <div className="auth-divider">
          <span />
          <span>{t('or')}</span>
          <span />
        </div>

        <button
          className="auth-link auth-link--accent"
          type="button"
          onClick={() => onNavigate('invite-code')}
        >
          {t('have_invite_code')}
        </button>

        {isDevMode && (
          <button
            className="auth-link auth-link--warning"
            type="button"
            disabled={loading}
            onClick={handleDevQuickLogin}
          >
            {t('create_dev_account')}
          </button>
        )}

        {serverInfo?.access_requests_enabled && (
          <button
            className="auth-link auth-link--muted"
            type="button"
            onClick={() => onNavigate('access-request')}
          >
            {t('request_access')}
          </button>
        )}
      </div>
    </div>
  )
}
