import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Ticket, CircleCheck, CircleX, Loader2 } from 'lucide-react'
import type { InviteValidation } from '../../lib/api.ts'
import type { AuthView } from '../../types.ts'
import { t } from '../../lib/i18n.ts'

type Props = {
  onValidateInvite: (code: string) => Promise<InviteValidation>
  onContinue: (code: string) => void
  onNavigate: (view: AuthView) => void
}

type ValidationState = 'idle' | 'checking' | 'valid' | 'invalid'

export function InviteCodeScreen({ onValidateInvite, onContinue, onNavigate }: Props) {
  const [code, setCode] = useState('')
  const [validation, setValidation] = useState<ValidationState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [serverName, setServerName] = useState('')

  const validate = useCallback(async (value: string) => {
    if (value.length < 4) {
      setValidation('idle')
      return
    }

    setValidation('checking')
    try {
      const result = await onValidateInvite(value)
      if (result.valid) {
        setValidation('valid')
        setServerName(result.server_name ?? '')
      } else {
        setValidation('invalid')
        setErrorMessage(result.reason ?? t('invalid_invite'))
      }
    } catch {
      setValidation('invalid')
      setErrorMessage(t('could_not_validate'))
    }
  }, [onValidateInvite])

  useEffect(() => {
    if (code.length < 4) {
      return
    }

    const timer = setTimeout(() => validate(code), 500)
    return () => clearTimeout(timer)
  }, [code, validate])

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <button className="auth-back" type="button" onClick={() => onNavigate('login')}>
          <ArrowLeft size={18} color="var(--text-muted)" strokeWidth={1.75} />
          <span>{t('back')}</span>
        </button>

        <div className="auth-card__header">
          <h1 className="auth-card__title auth-card__title--left">{t('enter_invite_code')}</h1>
          <p className="auth-card__subtitle auth-card__subtitle--left">
            {t('enter_invite_subtitle')}
          </p>
        </div>

        <div className="auth-form">
          <div className="auth-input-row">
            <Ticket size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input auth-input--mono"
              placeholder={t('invite_placeholder')}
              maxLength={16}
              value={code}
              onChange={(e) => {
                setValidation('idle')
                setErrorMessage('')
                setServerName('')
                setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))
              }}
              style={{ textAlign: 'center', letterSpacing: 2, fontFamily: 'JetBrains Mono, monospace' }}
            />
          </div>

          {validation === 'checking' && (
            <div className="auth-validation-status">
              <Loader2 size={16} className="auth-spinner-icon" />
              <span>{t('checking')}</span>
            </div>
          )}
          {validation === 'valid' && (
            <div className="auth-validation-status auth-validation-status--valid">
              <CircleCheck size={16} />
              <span>{t('valid_invite')}{serverName ? ` — ${serverName}` : ''}</span>
            </div>
          )}
          {validation === 'invalid' && (
            <div className="auth-validation-status auth-validation-status--invalid">
              <CircleX size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            className="auth-btn-primary"
            type="button"
            disabled={validation !== 'valid'}
            onClick={() => onContinue(code)}
          >
            {t('continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
