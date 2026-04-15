import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { Zap, User, PenLine, Lock, CircleCheck, CircleX, Eye, EyeOff } from 'lucide-react'
import { PasswordStrengthBar } from './PasswordStrengthBar.tsx'
import { t } from '../../lib/i18n.ts'

type Props = {
  serverUrl?: string
  serverName?: string | null
  error: string | null
  loading: boolean
  onCheckUsername: (username: string) => Promise<{ available: boolean }>
  onBootstrap: (username: string, displayName: string, password: string) => void
}

export function ServerBootstrapScreen({
  serverUrl,
  serverName,
  error,
  loading,
  onCheckUsername,
  onBootstrap
}: Props) {
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)

  const checkAvailability = useCallback(async (value: string) => {
    if (value.length < 3) {
      setUsernameAvailable(null)
      return
    }
    try {
      const result = await onCheckUsername(value)
      setUsernameAvailable(result.available)
    } catch {
      setUsernameAvailable(null)
    }
  }, [onCheckUsername])

  useEffect(() => {
    if (username.length < 3) {
      return
    }
    const timer = setTimeout(() => checkAvailability(username), 300)
    return () => clearTimeout(timer)
  }, [username, checkAvailability])

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const canSubmit =
    username.length >= 3 &&
    password.length >= 8 &&
    passwordsMatch &&
    usernameAvailable !== false &&
    !loading

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (canSubmit) {
      onBootstrap(username, displayName, password)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-card__logo">
          <Zap size={48} color="var(--accent)" strokeWidth={1.75} />
        </div>
        <h1 className="auth-card__title" style={{ fontSize: 20, fontWeight: 600 }}>{t('set_up_server')}</h1>
        <p className="auth-card__subtitle">
          {t('set_up_server_subtitle', serverName ?? serverUrl ?? window.location.host)}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-input-row">
            <PenLine size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              placeholder={t('display_name')}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="auth-input-row">
            <User size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              placeholder={t('username')}
              required
              value={username}
              onChange={(e) => {
                setUsernameAvailable(null)
                setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
              }}
              disabled={loading}
            />
            {usernameAvailable === true && <CircleCheck size={18} color="#22C55E" />}
            {usernameAvailable === false && <CircleX size={18} color="#FF453A" />}
          </div>

          <div>
            <div className="auth-input-row">
              <Lock size={18} color="var(--text-muted)" strokeWidth={1.75} />
              <input
                className="auth-input"
                type={showPassword ? 'text' : 'password'}
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
                {showPassword ? <EyeOff size={18} strokeWidth={1.75} /> : <Eye size={18} strokeWidth={1.75} />}
              </button>
            </div>
            <PasswordStrengthBar password={password} />
          </div>

          <div className={`auth-input-row${passwordsMismatch ? ' auth-input-row--error' : ''}${passwordsMatch ? ' auth-input-row--success' : ''}`}>
            <Lock size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              type={showPassword ? 'text' : 'password'}
              placeholder={t('confirm_password')}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-btn-primary" type="submit" disabled={!canSubmit}>
            {loading ? <span className="auth-spinner" /> : t('create_admin_account')}
          </button>
        </form>
      </div>
    </div>
  )
}
