import { useState, type FormEvent } from 'react'
import { ArrowLeft, User, CircleCheck } from 'lucide-react'
import type { AuthView } from '../../types.ts'
import { t } from '../../lib/i18n.ts'

type Props = {
  onRequestPasswordReset: (username: string, message?: string) => Promise<{ ok: boolean }>
  onNavigate: (view: AuthView) => void
}

export function ForgotPasswordScreen({ onRequestPasswordReset, onNavigate }: Props) {
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)

    try {
      await onRequestPasswordReset(username, message || undefined)
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
            <h1 className="auth-card__title">{t('request_sent')}</h1>
            <p className="auth-card__subtitle">
              {t('reset_sent_subtitle')}
            </p>
          </div>
          <button className="auth-link auth-link--accent" type="button" onClick={() => onNavigate('login')}>
            {t('back_to_login')}
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
          <span>{t('back')}</span>
        </button>

        <div className="auth-card__header">
          <h1 className="auth-card__title auth-card__title--left">{t('reset_password')}</h1>
          <p className="auth-card__subtitle auth-card__subtitle--left">
            {t('reset_password_subtitle')}
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-input-row">
            <User size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              placeholder={t('username')}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
          </div>

          <textarea
            className="auth-textarea auth-textarea--sm"
            placeholder={t('describe_issue')}
            maxLength={500}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={loading}
          />

          <button className="auth-btn-primary" type="submit" disabled={loading || !username}>
            {loading ? <span className="auth-spinner" /> : t('request_reset')}
          </button>
        </form>
      </div>
    </div>
  )
}
