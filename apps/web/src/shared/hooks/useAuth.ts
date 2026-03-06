/**
 * Auth state hook — owns storedDevice, view, profileUsername, isAdmin,
 * showInviteSheet, showOnboardingTip, and all auth handlers.
 *
 * Named useAuthState to avoid collision with the context consumer useAuth()
 * exported from shared/context/AuthContext.tsx.
 */

import { startTransition, useEffect, useState } from 'react'
import {
  issueChallenge,
  publishDevicePrekeys,
  verifyChallenge,
} from '../../lib/api'
import { generateDevicePrekeys, signChallenge } from '../../lib/device-auth'
import {
  persistStoredDevice,
  readStoredDevice,
  type AuthView,
  type StoredDevice,
} from '../context/AuthContext'
import type { Banner } from '../types/chat'

// ── Public interface ──────────────────────────────────────────────────────────

export interface AuthHookResult {
  storedDevice: StoredDevice | null
  /** Exposed so useConversation can patch prekey fields into the stored device. */
  setStoredDevice: (device: StoredDevice | null) => void
  view: AuthView
  setView: React.Dispatch<React.SetStateAction<AuthView>>
  profileUsername: string | null
  isAdmin: boolean
  /** Exposed so useChatList (via App.tsx callback) can set this after fetchMe. */
  setIsAdmin: (v: boolean) => void
  showInviteSheet: boolean
  setShowInviteSheet: (v: boolean) => void
  showOnboardingTip: boolean
  setShowOnboardingTip: (v: boolean) => void
  /** Re-authenticates the stored device via challenge–response. */
  handleReauthenticate: () => Promise<void>
  /** Generates a fresh signed prekey + one-time prekeys and publishes them. */
  handleRotatePrekeys: () => Promise<void>
  /**
   * Called by OnboardingStack after successful device registration / link.
   * Stores the device, refreshes the device list, transitions to 'chat' view
   * and shows the first-run onboarding tip once.
   */
  handleAuthenticated: (device: StoredDevice) => void
  /**
   * Resets all auth-owned state back to initial values (called as part of
   * handleForgetDevice in App.tsx).
   */
  clearAuthState: () => void
  /** True when the onboarding / auth screens should be shown. */
  isOnboarding: boolean
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseAuthParams {
  setLoading: (b: boolean) => void
  setBanner: (b: Banner | null) => void
  /** App.tsx-level callback: re-fetch the device list with the given session token. */
  onRefreshDeviceList: (token: string) => Promise<void>
}

export function useAuthState({
  setLoading,
  setBanner,
  onRefreshDeviceList,
}: UseAuthParams): AuthHookResult {
  const [storedDevice, setStoredDevice] = useState<StoredDevice | null>(() => readStoredDevice())
  const [view, setView] = useState<AuthView>(() => (readStoredDevice() ? 'chat' : 'welcome'))
  const [profileUsername, setProfileUsername] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [showInviteSheet, setShowInviteSheet] = useState(false)
  const [showOnboardingTip, setShowOnboardingTip] = useState(false)

  // ── Auto sign-in (R-AUTH-6) ───────────────────────────────────────────────
  // On mount: if a stored device identity exists, silently re-authenticate.
  // On failure (expired / revoked), drop back to sign-in screen.
  useEffect(() => {
    const initial = readStoredDevice()
    if (!initial) return

    let cancelled = false

    async function autoSignIn() {
      try {
        const challenge = await issueChallenge(initial!.deviceId)
        const signature = await signChallenge(challenge.challenge, initial!.privateKeyPkcs8Base64)
        const response = await verifyChallenge(initial!.deviceId, challenge.challenge_id, signature)

        if (cancelled) return

        const refreshed: StoredDevice = {
          ...initial!,
          sessionExpiresAt: response.session.expires_at,
          sessionToken: response.session.token,
        }

        persistStoredDevice(refreshed)
        setStoredDevice(refreshed)
        startTransition(() => setView('chat'))
      } catch {
        if (!cancelled) {
          startTransition(() => setView('login'))
        }
      }
    }

    void autoSignIn()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Profile username sync ─────────────────────────────────────────────────
  useEffect(() => {
    setProfileUsername(storedDevice?.username ?? null)
  }, [storedDevice])

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleReauthenticate() {
    if (!storedDevice) {
      setBanner({ tone: 'error', message: 'No local device identity is available.' })
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: 'Requesting a device challenge…' })

    try {
      const challenge = await issueChallenge(storedDevice.deviceId)
      const signature = await signChallenge(challenge.challenge, storedDevice.privateKeyPkcs8Base64)
      const response = await verifyChallenge(storedDevice.deviceId, challenge.challenge_id, signature)

      const nextStoredDevice: StoredDevice = {
        ...storedDevice,
        sessionExpiresAt: response.session.expires_at,
        sessionToken: response.session.token,
      }

      persistStoredDevice(nextStoredDevice)
      setStoredDevice(nextStoredDevice)
      await onRefreshDeviceList(nextStoredDevice.sessionToken)
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
    setBanner({ tone: 'info', message: 'Generating a fresh signed prekey and one-time prekeys…' })

    try {
      const devicePrekeys = await generateDevicePrekeys(storedDevice.privateKeyPkcs8Base64)
      const response = await publishDevicePrekeys(storedDevice.sessionToken, {
        signed_prekey: devicePrekeys.signedPrekey.publicKeyBase64,
        signed_prekey_signature: devicePrekeys.signedPrekey.signatureBase64,
        one_time_prekeys: devicePrekeys.oneTimePrekeys.map((prekey) => prekey.publicKeyBase64),
        replace_one_time_prekeys: true,
      })

      const nextStoredDevice: StoredDevice = {
        ...storedDevice,
        signedPrekeyPublicKeyBase64: devicePrekeys.signedPrekey.publicKeyBase64,
        signedPrekeyPrivateKeyPkcs8Base64: devicePrekeys.signedPrekey.privateKeyPkcs8Base64,
        signedPrekeys: [...(storedDevice.signedPrekeys ?? []), devicePrekeys.signedPrekey],
        oneTimePrekeys: [...(storedDevice.oneTimePrekeys ?? []), ...devicePrekeys.oneTimePrekeys],
      }

      persistStoredDevice(nextStoredDevice)
      setStoredDevice(nextStoredDevice)
      await onRefreshDeviceList(nextStoredDevice.sessionToken)
      setBanner({
        tone: 'success',
        message: `Prekeys rotated. ${response.one_time_prekey_count} one-time prekeys are active on the server.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rotate prekeys.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  function handleAuthenticated(device: StoredDevice) {
    persistStoredDevice(device)
    setStoredDevice(device)
    setProfileUsername(device.username)
    void onRefreshDeviceList(device.sessionToken)
    startTransition(() => setView('chat'))

    const seen = window.localStorage.getItem('vostok.hasSeenOnboarding')
    if (!seen) {
      window.localStorage.setItem('vostok.hasSeenOnboarding', 'true')
      setShowOnboardingTip(true)
      setTimeout(() => setShowOnboardingTip(false), 5000)
    }
  }

  function clearAuthState() {
    persistStoredDevice(null)
    setStoredDevice(null)
    setIsAdmin(false)
    setShowInviteSheet(false)
    setShowOnboardingTip(false)
    startTransition(() => setView('welcome'))
  }

  return {
    storedDevice,
    setStoredDevice,
    view,
    setView,
    profileUsername,
    isAdmin,
    setIsAdmin,
    showInviteSheet,
    setShowInviteSheet,
    showOnboardingTip,
    setShowOnboardingTip,
    handleReauthenticate,
    handleRotatePrekeys,
    handleAuthenticated,
    clearAuthState,
    isOnboarding: view !== 'chat',
  }
}
