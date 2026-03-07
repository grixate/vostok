import { startTransition, useState, useEffect, type FormEvent } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type { AuthView, StoredDevice } from '../types.ts'
import type { DeviceInfo } from '../lib/api.ts'
import {
  registerDevice,
  issueChallenge,
  verifyChallenge,
  publishDevicePrekeys,
  revokeDevice,
  listDevices,
  fetchMe
} from '../lib/api.ts'
import { generateDeviceIdentity, generateDevicePrekeys, signChallenge } from '../lib/device-auth.ts'
import { persistStoredDevice } from '../utils/storage.ts'

export function useAuth() {
  const { storedDevice, setStoredDevice, loading, setLoading, setBanner } = useAppContext()
  const [view, setView] = useState<AuthView>(() => (storedDevice ? 'chat' : 'welcome'))
  const [username, setUsername] = useState('')
  const [deviceName, setDeviceName] = useState('This browser')
  const [profileUsername, setProfileUsername] = useState<string | null>(null)
  const [_devices, setDevices] = useState<DeviceInfo[]>([])

  useEffect(() => {
    const nextDefault = storedDevice?.username ?? ''
    setProfileUsername(storedDevice?.username ?? null)
  }, [storedDevice])

  async function refreshDeviceList(sessionToken: string) {
    const response = await listDevices(sessionToken)
    setDevices(response.devices)
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setBanner({ tone: 'info', message: 'Generating a local device identity\u2026' })

    try {
      const identity = await generateDeviceIdentity()
      const devicePrekeys = await generateDevicePrekeys(identity.signingPrivateKeyPkcs8Base64)

      setBanner({ tone: 'info', message: 'Registering this device with the Vostok server\u2026' })

      const response = await registerDevice({
        username,
        device_name: deviceName,
        device_identity_public_key: identity.signingPublicKeyBase64,
        device_encryption_public_key: identity.encryptionPublicKeyBase64,
        signed_prekey: devicePrekeys.signedPrekey.publicKeyBase64,
        signed_prekey_signature: devicePrekeys.signedPrekey.signatureBase64,
        one_time_prekeys: devicePrekeys.oneTimePrekeys.map((prekey) => prekey.publicKeyBase64)
      })

      const nextStoredDevice: StoredDevice = {
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

      persistStoredDevice(nextStoredDevice)
      setStoredDevice(nextStoredDevice)
      setProfileUsername(response.user.username)
      await refreshDeviceList(nextStoredDevice.sessionToken)
      setBanner({
        tone: 'success',
        message: `Device registered. Session token issued with ${response.prekey_count} one-time prekeys.`
      })
      startTransition(() => setView('chat'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleReauthenticate() {
    if (!storedDevice) {
      setBanner({ tone: 'error', message: 'No local device identity is available.' })
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: 'Requesting a device challenge\u2026' })

    try {
      const challenge = await issueChallenge(storedDevice.deviceId)
      const signature = await signChallenge(challenge.challenge, storedDevice.privateKeyPkcs8Base64)
      const response = await verifyChallenge(storedDevice.deviceId, challenge.challenge_id, signature)

      const nextStoredDevice = {
        ...storedDevice,
        sessionExpiresAt: response.session.expires_at,
        sessionToken: response.session.token
      }

      persistStoredDevice(nextStoredDevice)
      setStoredDevice(nextStoredDevice)
      await refreshDeviceList(nextStoredDevice.sessionToken)
      setBanner({ tone: 'success', message: 'Challenge verified. Session refreshed.' })
      startTransition(() => setView('chat'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleRotatePrekeys() {
    if (!storedDevice) {
      setBanner({ tone: 'error', message: 'No local device identity is available.' })
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: 'Generating a fresh signed prekey and one-time prekeys\u2026' })

    try {
      const devicePrekeys = await generateDevicePrekeys(storedDevice.privateKeyPkcs8Base64)
      const response = await publishDevicePrekeys(storedDevice.sessionToken, {
        signed_prekey: devicePrekeys.signedPrekey.publicKeyBase64,
        signed_prekey_signature: devicePrekeys.signedPrekey.signatureBase64,
        one_time_prekeys: devicePrekeys.oneTimePrekeys.map((prekey) => prekey.publicKeyBase64),
        replace_one_time_prekeys: true
      })

      const nextStoredDevice: StoredDevice = {
        ...storedDevice,
        signedPrekeyPublicKeyBase64: devicePrekeys.signedPrekey.publicKeyBase64,
        signedPrekeyPrivateKeyPkcs8Base64: devicePrekeys.signedPrekey.privateKeyPkcs8Base64,
        signedPrekeys: [...(storedDevice.signedPrekeys ?? []), devicePrekeys.signedPrekey],
        oneTimePrekeys: [...(storedDevice.oneTimePrekeys ?? []), ...devicePrekeys.oneTimePrekeys]
      }

      persistStoredDevice(nextStoredDevice)
      setStoredDevice(nextStoredDevice)
      await refreshDeviceList(nextStoredDevice.sessionToken)
      setBanner({
        tone: 'success',
        message: `Prekeys rotated. ${response.one_time_prekey_count} one-time prekeys are active on the server.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rotate prekeys.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  function handleForgetDevice() {
    persistStoredDevice(null)
    setStoredDevice(null)
    setDevices([])
    setBanner({ tone: 'info', message: 'Local device identity cleared from this browser.' })
    startTransition(() => setView('welcome'))
  }

  async function _handleRevokeLinkedDevice(deviceId: string) {
    if (!storedDevice) {
      return
    }

    setLoading(true)

    try {
      const response = await revokeDevice(storedDevice.sessionToken, deviceId)
      await refreshDeviceList(storedDevice.sessionToken)
      setBanner({
        tone: 'success',
        message: `Revoked ${response.device.device_name}. Existing sessions for that device are now invalid.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke device.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  return {
    view,
    setView,
    username,
    setUsername,
    deviceName,
    setDeviceName,
    profileUsername,
    setProfileUsername,
    handleRegister,
    handleReauthenticate,
    handleForgetDevice,
    _handleRotatePrekeys,
    _handleRevokeLinkedDevice,
    refreshDeviceList,
    setDevices,
    fetchMe
  }
}
