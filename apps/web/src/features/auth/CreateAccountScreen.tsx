import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { ArrowLeft, User, PenLine, Lock, CircleCheck, CircleX, Eye, EyeOff } from 'lucide-react'
import { PasswordStrengthBar } from './PasswordStrengthBar.tsx'
import type { AuthView, ServerInfo } from '../../types.ts'

type Props = {
  inviteCode: string | null
  serverInfo: ServerInfo | null
  serverUrl?: string
  serverName?: string | null
  error: string | null
  loading: boolean
  onCheckUsername: (username: string) => Promise<{ available: boolean }>
  onRegister: (inviteCode: string | null, username: string, displayName: string, password: string) => void
  onNavigate: (view: AuthView) => void
}

function generateDevUsername(): string {
  const n = Math.floor(1000 + Math.random() * 9000)
  return `dev_user_${n}`
}

export function CreateAccountScreen({
  inviteCode,
  serverInfo,
  serverUrl,
  serverName,
  error,
  loading,
  onCheckUsername,
  onRegister,
  onNavigate
}: Props) {
  const isDevMode = serverInfo?.auth_mode === 'dev'

  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState(isDevMode ? 'password' : '')
  const [confirmPassword, setConfirmPassword] = useState(isDevMode ? 'password' : '')
  const [showPassword, setShowPassword] = useState(false)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)

  const serverDisplay = serverName ?? serverInfo?.name ?? serverUrl ?? window.location.host

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
      onRegister(inviteCode, username, displayName, password)
    }
  }

  // In dev mode, back goes to login. With invite, back goes to invite screen.
  // Without invite in normal mode, back goes to login.
  const backTarget: AuthView = inviteCode ? 'invite-code' : 'login'

  return (
    <div className="auth-shell">
      {isDevMode && (
        <div className="auth-dev-banner">
          <span>⚠ DEV MODE — Open registration enabled. Do not use in production.</span>
        </div>
      )}
      <div className="auth-card">
        <button
          className="auth-back"
          type="button"
          onClick={() => onNavigate(backTarget)}
        >
          <ArrowLeft size={18} color="var(--text-muted)" strokeWidth={1.75} />
          <span>Back</span>
        </button>

        <div className="auth-card__header">
          <h1 className="auth-card__title auth-card__title--left">
            {isDevMode ? 'Create Dev Account' : 'Create Your Account'}
          </h1>
          <p className="auth-card__subtitle auth-card__subtitle--left">
            Joining {serverDisplay}
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-input-row">
            <User size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              placeholder="Username"
              required
              value={username}
              onChange={(e) => {
                setUsernameAvailable(null)
                setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
              }}
              disabled={loading}
            />
            {isDevMode && (
              <button
                type="button"
                className="auth-random-btn"
                onClick={() => {
                  setUsernameAvailable(null)
                  setUsername(generateDevUsername())
                }}
                tabIndex={-1}
              >
                Random
              </button>
            )}
            {!isDevMode && usernameAvailable === true && <CircleCheck size={18} color="#22C55E" />}
            {usernameAvailable === false && <CircleX size={18} color="#FF453A" />}
          </div>

          <div className="auth-input-row">
            <PenLine size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              placeholder="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={loading}
            />
          </div>

          <div>
            <div className="auth-input-row">
              <Lock size={18} color="var(--text-muted)" strokeWidth={1.75} />
              <input
                className="auth-input"
                type={showPassword ? 'text' : 'password'}
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
                {showPassword ? <EyeOff size={18} strokeWidth={1.75} /> : <Eye size={18} strokeWidth={1.75} />}
              </button>
            </div>
            {!isDevMode && <PasswordStrengthBar password={password} />}
          </div>

          <div className={`auth-input-row${passwordsMismatch ? ' auth-input-row--error' : ''}${passwordsMatch ? ' auth-input-row--success' : ''}`}>
            <Lock size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              type={showPassword ? 'text' : 'password'}
              placeholder="Confirm Password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
            />
            {passwordsMatch && <CircleCheck size={18} color="#22C55E" />}
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-btn-primary" type="submit" disabled={!canSubmit}>
            {loading ? <span className="auth-spinner" /> : (isDevMode ? 'Create Dev Account' : 'Create Account')}
          </button>
        </form>
      </div>
    </div>
  )
}
