import { useState, type FormEvent } from 'react'
import { Lock, ShieldAlert, Eye, EyeOff } from 'lucide-react'
import { PasswordStrengthBar } from './PasswordStrengthBar.tsx'

type Props = {
  error: string | null
  loading: boolean
  onChangePassword: (newPassword: string) => void
}

export function ForcePasswordChangeScreen({ error, loading, onChangePassword }: Props) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const canSubmit = password.length >= 8 && passwordsMatch && !loading

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (canSubmit) {
      onChangePassword(password)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-lock-banner">
          <ShieldAlert size={16} />
          <span>You must set a new password to continue.</span>
        </div>

        <div className="auth-card__header">
          <h1 className="auth-card__title auth-card__title--left">Set a New Password</h1>
          <p className="auth-card__subtitle auth-card__subtitle--left">
            Your temporary password has expired. Please set a permanent one.
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div>
            <div className="auth-input-row">
              <Lock size={18} color="var(--text-muted)" strokeWidth={1.75} />
              <input
                className="auth-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="New Password"
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
              placeholder="Confirm New Password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-btn-primary" type="submit" disabled={!canSubmit}>
            {loading ? <span className="auth-spinner" /> : 'Set Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
