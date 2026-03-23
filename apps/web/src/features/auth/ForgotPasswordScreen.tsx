import { useState, type FormEvent } from 'react'
import { ArrowLeft, User, CircleCheck } from 'lucide-react'
import { requestPasswordReset } from '../../lib/api.ts'
import type { AuthView } from '../../types.ts'

type Props = {
  onNavigate: (view: AuthView) => void
}

export function ForgotPasswordScreen({ onNavigate }: Props) {
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)

    try {
      await requestPasswordReset(username, message || undefined)
    } catch {
      // Always show success to prevent username enumeration
    }

    setSubmitted(true)
    setLoading(false)
  }

  if (submitted) {
    return (
      <div className="auth-shell">
        <div className="auth-card auth-card--centered">
          <CircleCheck size={64} color="#22C55E" strokeWidth={1.5} />
          <div className="auth-card__header" style={{ alignItems: 'center' }}>
            <h1 className="auth-card__title">Request Sent</h1>
            <p className="auth-card__subtitle">
              The administrator has been notified. If approved, you'll be able to reset your password.
            </p>
          </div>
          <button className="auth-link auth-link--accent" type="button" onClick={() => onNavigate('login')}>
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <button className="auth-back" type="button" onClick={() => onNavigate('login')}>
          <ArrowLeft size={18} color="var(--text-muted)" strokeWidth={1.75} />
          <span>Back</span>
        </button>

        <div className="auth-card__header">
          <h1 className="auth-card__title auth-card__title--left">Reset Password</h1>
          <p className="auth-card__subtitle auth-card__subtitle--left">
            Password resets are handled by your server administrator. Describe your issue and they will assist you.
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
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
          </div>

          <textarea
            className="auth-textarea auth-textarea--sm"
            placeholder="Describe your issue..."
            maxLength={500}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={loading}
          />

          <button className="auth-btn-primary" type="submit" disabled={loading || !username}>
            {loading ? <span className="auth-spinner" /> : 'Request Reset'}
          </button>
        </form>
      </div>
    </div>
  )
}
