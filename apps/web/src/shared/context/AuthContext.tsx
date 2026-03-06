import { createContext, useContext, type ReactNode } from 'react'
import type { PrekeyPair, SignedPrekeyPair } from '../../lib/device-auth'
import type { DeviceInfo } from '../../lib/api'

// ─── Types ─────────────────────────────────────────────────────────────────

export type AuthView = 'welcome' | 'register' | 'login' | 'link' | 'chat'

export type StoredDevice = {
  deviceId: string
  deviceName: string
  privateKeyPkcs8Base64: string
  publicKeyBase64: string
  encryptionPrivateKeyPkcs8Base64?: string
  encryptionPublicKeyBase64?: string
  signedPrekeyPublicKeyBase64?: string
  signedPrekeyPrivateKeyPkcs8Base64?: string
  signedPrekeys?: SignedPrekeyPair[]
  oneTimePrekeys?: PrekeyPair[]
  sessionExpiresAt: string
  sessionToken: string
  username: string
}

export const STORAGE_KEY = 'vostok.device'

export function readStoredDevice(): StoredDevice | null {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredDevice
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function persistStoredDevice(device: StoredDevice | null) {
  if (device) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(device))
  } else {
    window.localStorage.removeItem(STORAGE_KEY)
  }
}

// ─── Context ───────────────────────────────────────────────────────────────

export type AuthContextValue = {
  storedDevice: StoredDevice | null
  profileUsername: string | null
  isAdmin: boolean
  showInviteSheet: boolean
  setShowInviteSheet: (v: boolean) => void
  showOnboardingTip: boolean
  setShowOnboardingTip: (v: boolean) => void
  handleReauthenticate: () => Promise<void>
  handleRotatePrekeys: () => Promise<void>
  /** Clears all local state and returns to the welcome screen. */
  handleForgetDevice: () => void
  /** Revokes a linked device (admin operation). */
  handleRevokeLinkedDevice: (deviceId: string) => Promise<void>
  /** All registered devices for this account. */
  devices: DeviceInfo[]
  /** Number of messages queued in the offline outbox. */
  outboxPendingCount: number
}

export const AuthContext = createContext<AuthContextValue | null>(null)

/** Context consumer — use inside components rendered below AuthContext.Provider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthContext.Provider')
  return ctx
}

export function AuthProvider({
  children,
  value,
}: {
  children: ReactNode
  value: AuthContextValue
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
