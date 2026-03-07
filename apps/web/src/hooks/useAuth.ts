import { startTransition, useEffect, useState, type FormEvent } from 'react'
import type { AuthView, StoredDevice } from '../types'
import type { DeviceInfo } from '../lib/api'
import {
  listDevices,
  registerDevice,
  issueChallenge,
  verifyChallenge,
  publishDevicePrekeys
} from '../lib/api'
import {
  generateDeviceIdentity,
  generateDevicePrekeys,
  signChallenge
} from '../lib/device-auth'
import { persistStoredDevice, readStoredDevice } from '../utils/storage'
import { useAppContext } from '../contexts/AppContext'

export function useAuth(onForgetDevice?: () => void) {
  const { storedDevice, setStoredDevice, setBanner, setLoading } = useAppContext()

  const [view, setView] = useState<AuthView>(() => (readStoredDevice() ? 'chat' : 'welcome'))
  const [username, setUsername] = useState('')
  const [deviceName, setDeviceName] = useState('This browser')
  const [profileUsername, setProfileUsername] = useState<string | null>(null)
  const [devices, setDevices] = useState<DeviceInfo[]>([])

  // Profile username sync
  useEffect(() => {
    const nextDefault = storedDevice?.username ?? ''
    setProfileUsername(storedDevice?.username ?? null)
    // The newChatUsername default is handled by the chatList hook; we only do
    // profile-related syncing here.
    void nextDefault
  }, [storedDevice])

  async function refreshDeviceList(sessionToken: string) {
    const response = await listDevices(sessionToken)
    setDevices(response.devices)
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setBanner({ tone: 'info', message: 'Generating a local device identity...' })

    try {
      const identity = await generateDeviceIdentity()
      const devicePrekeys = await generateDevicePrekeys(identity.signingPrivateKeyPkcs8Base64)

      setBanner({ tone: 'info', message: 'Registering this device with the Vostok server...' })

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
    setBanner({ tone: 'info', message: 'Requesting a device challenge...' })

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

  async function handleRotatePrekeys() {
    if (!storedDevice) {
      setBanner({ tone: 'error', message: 'No local device identity is available.' })
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: 'Generating a fresh signed prekey and one-time prekeys...' })

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
    onForgetDevice?.()
    setBanner({ tone: 'info', message: 'Local device identity cleared from this browser.' })
    startTransition(() => setView('welcome'))
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
    devices,
    setDevices,
    refreshDeviceList,
    handleRegister,
    handleReauthenticate,
    handleRotatePrekeys,
    handleForgetDevice
  }
}
