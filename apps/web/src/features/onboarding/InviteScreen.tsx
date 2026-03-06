import { useState, type FormEvent } from 'react'
import { validateInviteToken } from '../../lib/api'
import type { NavigationStack, OnboardingScreen } from '../../shared/hooks/useNavigation'

interface Props {
  nav: NavigationStack<OnboardingScreen>
  onTokenValidated: (token: string) => void
}

export function InviteScreen({ nav, onTokenValidated }: Props) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = token.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)

    try {
      const result = await validateInviteToken(trimmed)
      if (result.valid) {
        onTokenValidated(trimmed)
        nav.push('create-account')
      } else {
        const reasons: Record<string, string> = {
          expired: 'This invite has expired.',
          used: 'This invite has already been used.',
          revoked: 'This invite has been revoked.',
          not_found: 'Invite not found. Check the code and try again.'
        }
        setError(reasons[result.reason] ?? 'Invalid invite.')
      }
    } catch {
      setError('Could not reach the server. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="onboarding-screen">
      <div className="onboarding-card">
        <button
          className="onboarding-back"
          type="button"
          onClick={() => nav.pop()}
          aria-label="Back"
        >
          ←
        </button>

        <h2 className="onboarding-card__title">Enter invite code</h2>
        <p className="onboarding-card__description">
          Vostok is invite-only. Paste or type your invite code below.
        </p>

        <form className="onboarding-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="auth-field">
            <span>Invite code</span>
            <input
              autoFocus
              autoComplete="off"
              disabled={loading}
              onChange={(e) => {
                setToken(e.target.value)
                setError(null)
              }}
              placeholder="Paste invite code…"
              spellCheck={false}
              value={token}
            />
          </label>
          {error ? <span className="onboarding-field-error">{error}</span> : null}

          <button
            className="primary-action"
            disabled={loading || token.trim() === ''}
            type="submit"
          >
            {loading ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
