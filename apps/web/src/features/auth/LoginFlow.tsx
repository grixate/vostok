import { useState } from 'react'
import { Zap, User, Lock, Eye, EyeOff, PenLine, ArrowLeft } from 'lucide-react'
import type { useAuth } from '../../hooks/useAuth.ts'

type LoginFlowProps = {
  auth: ReturnType<typeof useAuth>
}

export function LoginFlow({ auth }: LoginFlowProps) {
  const [showPassword, setShowPassword] = useState(false)

  const serverUrl = window.location.host

  // Login screen (default when storedDevice exists)
  if (auth.view === 'login') {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-card__logo">
            <Zap size={40} color="var(--accent)" strokeWidth={1.75} />
          </div>
          <h1 className="auth-card__title">Vostok</h1>
          <p className="auth-card__subtitle">{serverUrl}</p>

          <div className="auth-form">
            <button
              className="auth-btn-primary"
              onClick={auth.handleReauthenticate}
              type="button"
            >
              Sign In
            </button>
          </div>

          <div className="auth-divider">
            <span />
            <span>or</span>
            <span />
          </div>

          <button
            className="auth-link auth-link--accent"
            type="button"
            onClick={() => auth.setView('link')}
          >
            I have an invite code
          </button>
          <button
            className="auth-link auth-link--muted"
            type="button"
            onClick={() => { auth.setView('register') }}
          >
            Create a new account
          </button>
        </div>
      </div>
    )
  }

  // Link device screen
  if (auth.view === 'link') {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <button
            className="auth-back"
            type="button"
            onClick={() => auth.setView('welcome')}
          >
            <ArrowLeft size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <span>Back</span>
          </button>

          <div className="auth-card__header">
            <h1 className="auth-card__title auth-card__title--left">Link Device</h1>
            <p className="auth-card__subtitle auth-card__subtitle--left">Connect to an existing account</p>
          </div>

          <div className="auth-form">
            <div className="auth-input-row">
              <Lock size={18} color="var(--text-muted)" strokeWidth={1.75} />
              <input
                className="auth-input"
                disabled
                placeholder="Pairing code"
                value=""
                readOnly
              />
            </div>
            <button className="auth-btn-primary auth-btn-primary--disabled" disabled type="button">
              Link Device
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Register / Welcome screen
  return (
    <div className="auth-shell">
      <div className="auth-card">
        {auth.view === 'register' ? (
          <button
            className="auth-back"
            type="button"
            onClick={() => auth.setView('welcome')}
          >
            <ArrowLeft size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <span>Back</span>
          </button>
        ) : (
          <>
            <div className="auth-card__logo">
              <Zap size={40} color="var(--accent)" strokeWidth={1.75} />
            </div>
            <h1 className="auth-card__title">Vostok</h1>
            <p className="auth-card__subtitle">{serverUrl}</p>
          </>
        )}

        {auth.view === 'register' ? (
          <div className="auth-card__header">
            <h1 className="auth-card__title auth-card__title--left">Create Your Account</h1>
            <p className="auth-card__subtitle auth-card__subtitle--left">Joining {serverUrl}</p>
          </div>
        ) : null}

        <form className="auth-form" onSubmit={auth.handleRegister}>
          <div className="auth-input-row">
            <User size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              autoComplete="username"
              onChange={(event) => auth.setUsername(event.target.value)}
              placeholder="Username"
              required
              value={auth.username}
            />
          </div>

          <div className="auth-input-row">
            <PenLine size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              onChange={(event) => auth.setDeviceName(event.target.value)}
              placeholder="Device name"
              required
              value={auth.deviceName}
            />
          </div>

          <button className="auth-btn-primary" type="submit">
            Create Account
          </button>
        </form>

        {auth.view === 'welcome' ? (
          <>
            <div className="auth-divider">
              <span />
              <span>or</span>
              <span />
            </div>

            <button
              className="auth-link auth-link--accent"
              type="button"
              onClick={() => auth.setView('login')}
            >
              Sign in to existing account
            </button>
            <button
              className="auth-link auth-link--accent"
              type="button"
              onClick={() => auth.setView('link')}
            >
              I have an invite code
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
