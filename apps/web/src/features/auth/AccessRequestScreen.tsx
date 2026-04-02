import { useState, type FormEvent } from 'react'
import { ArrowLeft, User, CircleCheck } from 'lucide-react'
import type { AuthView } from '../../types.ts'

type Props = {
  onRequestAccess: (name: string, message?: string) => Promise<{ ok: boolean }>
  onNavigate: (view: AuthView) => void
}

export function AccessRequestScreen({ onRequestAccess, onNavigate }: Props) {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      await onRequestAccess(name, message || undefined)
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send request.')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="auth-shell">
        <div className="auth-card auth-card--centered">
          <CircleCheck size={64} color="#22C55E" strokeWidth={1.5} />
          <div className="auth-card__header" style={{ alignItems: 'center' }}>
            <h1 className="auth-card__title">Request Sent</h1>
            <p className="auth-card__subtitle">
              The admin will review your request and reach out to you.
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
          <h1 className="auth-card__title auth-card__title--left">Request Access</h1>
          <p className="auth-card__subtitle auth-card__subtitle--left">
            Your request will be reviewed by the server administrator.
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-input-row">
            <User size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              placeholder="Your name"
              required
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
          </div>

          <textarea
            className="auth-textarea"
            placeholder="Why would you like access? (optional)"
            maxLength={500}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={loading}
          />

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-btn-primary" type="submit" disabled={loading || !name}>
            {loading ? <span className="auth-spinner" /> : 'Send Request'}
          </button>
        </form>
      </div>
    </div>
  )
}
