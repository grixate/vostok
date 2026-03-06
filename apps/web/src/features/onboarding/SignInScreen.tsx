import { useState } from 'react'
import { issueChallenge, verifyChallenge } from '../../lib/api'
import { signChallenge } from '../../lib/device-auth'
import { persistStoredDevice, readStoredDevice, type StoredDevice } from '../../shared/context/AuthContext'
import type { NavigationStack, OnboardingScreen } from '../../shared/hooks/useNavigation'

interface Props {
  nav: NavigationStack<OnboardingScreen>
  onSignedIn: (device: StoredDevice) => void
}

export function SignInScreen({ nav, onSignedIn }: Props) {
  const storedDevice = readStoredDevice()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleReauthenticate() {
    if (!storedDevice) return
    setLoading(true)
    setError(null)

    try {
      const challenge = await issueChallenge(storedDevice.deviceId)
      const signature = await signChallenge(challenge.challenge, storedDevice.privateKeyPkcs8Base64)
      const response = await verifyChallenge(storedDevice.deviceId, challenge.challenge_id, signature)

      const next: StoredDevice = {
        ...storedDevice,
        sessionExpiresAt: response.session.expires_at,
        sessionToken: response.session.token
      }

      persistStoredDevice(next)
      onSignedIn(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.')
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
          disabled={loading}
          aria-label="Back"
        >
          ←
        </button>

        <h2 className="onboarding-card__title">Sign in</h2>

        {storedDevice ? (
          <>
            <div className="sign-in-device-summary">
              <strong>{storedDevice.username}</strong>
              <span>{storedDevice.deviceName}</span>
            </div>

            {error ? <span className="onboarding-field-error">{error}</span> : null}

            <button
              className="primary-action"
              disabled={loading}
              onClick={() => void handleReauthenticate()}
              type="button"
            >
              {loading ? 'Signing in…' : 'Sign in with stored key'}
            </button>
          </>
        ) : (
          <p className="onboarding-card__description">
            No device identity found on this device. Create a new account to get started.
          </p>
        )}

        <button
          className="onboarding-actions__link"
          type="button"
          onClick={() => nav.replace('invite')}
        >
          Create a new account →
        </button>
      </div>
    </div>
  )
}
