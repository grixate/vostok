import { useState, type FormEvent } from 'react'
import { generateDeviceIdentity, generateDevicePrekeys } from '../../lib/device-auth'
import { registerDevice } from '../../lib/api'
import { persistStoredDevice, type StoredDevice } from '../../shared/context/AuthContext'
import type { NavigationStack, OnboardingScreen } from '../../shared/hooks/useNavigation'

interface Props {
  nav: NavigationStack<OnboardingScreen>
  inviteToken: string | null
  onRegistered: (device: StoredDevice) => void
}

export function CreateAccountScreen({ nav, inviteToken, onRegistered }: Props) {
  const [username, setUsername] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedUsername = username.trim()
    const trimmedDevice = deviceName.trim()
    if (!trimmedUsername || !trimmedDevice) return

    setLoading(true)
    setError(null)
    nav.push('key-generation')

    try {
      const identity = await generateDeviceIdentity()
      const devicePrekeys = await generateDevicePrekeys(identity.signingPrivateKeyPkcs8Base64)

      const response = await registerDevice({
        username: trimmedUsername,
        device_name: trimmedDevice,
        device_identity_public_key: identity.signingPublicKeyBase64,
        device_encryption_public_key: identity.encryptionPublicKeyBase64,
        signed_prekey: devicePrekeys.signedPrekey.publicKeyBase64,
        signed_prekey_signature: devicePrekeys.signedPrekey.signatureBase64,
        one_time_prekeys: devicePrekeys.oneTimePrekeys.map((k) => k.publicKeyBase64),
        ...(inviteToken ? { invite_token: inviteToken } : {})
      })

      const stored: StoredDevice = {
        deviceId: response.device.id,
        deviceName: response.device.device_name,
        privateKeyPkcs8Base64: identity.signingPrivateKeyPkcs8Base64,
        publicKeyBase64: identity.signingPublicKeyBase64,
        encryptionPrivateKeyPkcs8Base64: identity.encryptionPrivateKeyPkcs8Base64,
        encryptionPublicKeyBase64: identity.encryptionPublicKeyBase64,
        signedPrekeyPublicKeyBase64: devicePrekeys.signedPrekey.publicKeyBase64,
        signedPrekeyPrivateKeyPkcs8Base64: devicePrekeys.signedPrekey.privateKeyPkcs8Base64,
        signedPrekeys: [devicePrekeys.signedPrekey],
        oneTimePrekeys: devicePrekeys.oneTimePrekeys,
        sessionExpiresAt: response.session.expires_at,
        sessionToken: response.session.token,
        username: response.user.username
      }

      persistStoredDevice(stored)
      onRegistered(stored)
    } catch (err) {
      nav.pop()
      setError(err instanceof Error ? err.message : 'Registration failed.')
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

        <h2 className="onboarding-card__title">Create your account</h2>
        <p className="onboarding-card__description">
          No email or phone needed. Your username identifies you in Vostok.
        </p>

        <form className="onboarding-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="auth-field">
            <span>Username</span>
            <input
              autoFocus
              autoComplete="username"
              disabled={loading}
              maxLength={32}
              minLength={3}
              onChange={(e) => {
                setUsername(e.target.value)
                setError(null)
              }}
              placeholder="yourname"
              value={username}
            />
          </label>

          <label className="auth-field">
            <span>Device name</span>
            <input
              autoComplete="off"
              disabled={loading}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="MacBook Pro"
              value={deviceName}
            />
          </label>

          {error ? <span className="onboarding-field-error">{error}</span> : null}

          <button
            className="primary-action"
            disabled={loading || username.trim().length < 3 || deviceName.trim() === ''}
            type="submit"
          >
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
