import type {
  StorageType,
  KeyPairType,
  Direction
} from '@privacyresearch/libsignal-protocol-typescript'
import {
  bootstrapSecureStore,
  clearSecureStorePrefixes,
  persistSecureStoreValue,
  removeSecureStoreValue
} from './secure-kv-store'
import { bytesToBase64, base64ToBytes } from './base64'

// Bootstrap Signal-related localStorage prefixes into IndexedDB
const SIGNAL_IDENTITY_PREFIX = 'signal.identity.'
const SIGNAL_PREKEY_PREFIX = 'signal.prekey.'
const SIGNAL_SIGNED_PREKEY_PREFIX = 'signal.signed-prekey.'
const SIGNAL_SESSION_PREFIX = 'signal.session.'
const SIGNAL_DEVICE_MARKER_KEY = 'signal.device-marker'

void bootstrapSecureStore([
  SIGNAL_IDENTITY_PREFIX,
  SIGNAL_PREKEY_PREFIX,
  SIGNAL_SIGNED_PREKEY_PREFIX,
  SIGNAL_SESSION_PREFIX
])

const SIGNAL_RESET_PREFIXES = [
  SIGNAL_IDENTITY_PREFIX,
  SIGNAL_SESSION_PREFIX
]

function hasSignalStateForReset(): boolean {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false
  }

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key && SIGNAL_RESET_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      return true
    }
  }

  return false
}

function clearSignalStateForDeviceSwitch(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return
  }

  const keysToRemove: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key && SIGNAL_RESET_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    window.localStorage.removeItem(key)
  }

  void clearSecureStorePrefixes(SIGNAL_RESET_PREFIXES)
}

function signalDeviceMarker(identityKeyPair: KeyPairType, registrationId: number): string {
  return `${registrationId}:${arrayBufferToBase64(identityKeyPair.pubKey)}`
}

// ── ArrayBuffer ↔ Base64 helpers ────────────────────────────────────────────

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer))
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bytes = base64ToBytes(b64)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function arrayBufferEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false
  const va = new Uint8Array(a)
  const vb = new Uint8Array(b)
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vb[i]) return false
  }
  return true
}

// ── Serialization helpers ───────────────────────────────────────────────────

function serializeKeyPair(kp: KeyPairType): string {
  return JSON.stringify({
    pubKey: arrayBufferToBase64(kp.pubKey),
    privKey: arrayBufferToBase64(kp.privKey)
  })
}

function deserializeKeyPair(json: string): KeyPairType {
  const parsed = JSON.parse(json) as { pubKey: string; privKey: string }
  return {
    pubKey: base64ToArrayBuffer(parsed.pubKey),
    privKey: base64ToArrayBuffer(parsed.privKey)
  }
}

// ── Storage key helpers ─────────────────────────────────────────────────────

function identityStorageKey(address: string): string {
  return `${SIGNAL_IDENTITY_PREFIX}${address}`
}

function preKeyKey(keyId: number | string): string {
  return `${SIGNAL_PREKEY_PREFIX}${keyId}`
}

function signedPreKeyKey(keyId: number | string): string {
  return `${SIGNAL_SIGNED_PREKEY_PREFIX}${keyId}`
}

function sessionKey(address: string): string {
  return `${SIGNAL_SESSION_PREFIX}${address}`
}

// ── VostokSignalStore ───────────────────────────────────────────────────────

export class VostokSignalStore implements StorageType {
  private identityKeyPair: KeyPairType
  private registrationId: number

  constructor(identityKeyPair: KeyPairType, registrationId: number) {
    this.identityKeyPair = identityKeyPair
    this.registrationId = registrationId
  }

  // ── Identity ────────────────────────────────────────────────────────────

  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    return this.identityKeyPair
  }

  async getLocalRegistrationId(): Promise<number | undefined> {
    return this.registrationId
  }

  async isTrustedIdentity(
    identifier: string,
    remoteIdentityKey: ArrayBuffer,
    _direction: Direction
  ): Promise<boolean> {
    const stored = window.localStorage.getItem(identityStorageKey(identifier))
    if (!stored) return true // TOFU: trust on first use
    return arrayBufferEqual(base64ToArrayBuffer(stored), remoteIdentityKey)
  }

  async saveIdentity(
    encodedAddress: string,
    publicKey: ArrayBuffer
  ): Promise<boolean> {
    const existing = window.localStorage.getItem(identityStorageKey(encodedAddress))
    persistSecureStoreValue(identityStorageKey(encodedAddress), arrayBufferToBase64(publicKey))
    return existing !== null && !arrayBufferEqual(base64ToArrayBuffer(existing), publicKey)
  }

  // ── Pre Keys ────────────────────────────────────────────────────────────

  async loadPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    const raw = window.localStorage.getItem(preKeyKey(keyId))
    return raw ? deserializeKeyPair(raw) : undefined
  }

  async storePreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    persistSecureStoreValue(preKeyKey(keyId), serializeKeyPair(keyPair))
  }

  async removePreKey(keyId: number | string): Promise<void> {
    removeSecureStoreValue(preKeyKey(keyId))
  }

  // ── Signed Pre Keys ────────────────────────────────────────────────────

  async loadSignedPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    const raw = window.localStorage.getItem(signedPreKeyKey(keyId))
    return raw ? deserializeKeyPair(raw) : undefined
  }

  async storeSignedPreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    persistSecureStoreValue(signedPreKeyKey(keyId), serializeKeyPair(keyPair))
  }

  async removeSignedPreKey(keyId: number | string): Promise<void> {
    removeSecureStoreValue(signedPreKeyKey(keyId))
  }

  // ── Sessions ────────────────────────────────────────────────────────────

  async loadSession(encodedAddress: string): Promise<string | undefined> {
    const raw = window.localStorage.getItem(sessionKey(encodedAddress))
    return raw ?? undefined
  }

  async storeSession(encodedAddress: string, record: string): Promise<void> {
    persistSecureStoreValue(sessionKey(encodedAddress), record)
  }
}

// ── Global singleton ────────────────────────────────────────────────────────

let _globalStore: VostokSignalStore | null = null

export function getSignalStore(): VostokSignalStore {
  if (!_globalStore) {
    throw new Error('Signal store not initialized. Call initSignalStore() first.')
  }
  return _globalStore
}

export function initSignalStore(identityKeyPairJson: string, registrationId: number): VostokSignalStore {
  const parsed = JSON.parse(identityKeyPairJson) as { pubKey: string; privKey: string }
  const identityKeyPair: KeyPairType = {
    pubKey: base64ToArrayBuffer(parsed.pubKey),
    privKey: base64ToArrayBuffer(parsed.privKey)
  }

  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    const nextMarker = signalDeviceMarker(identityKeyPair, registrationId)
    const previousMarker = window.localStorage.getItem(SIGNAL_DEVICE_MARKER_KEY)

    if ((previousMarker && previousMarker !== nextMarker) || (!previousMarker && hasSignalStateForReset())) {
      clearSignalStateForDeviceSwitch()
    }

    persistSecureStoreValue(SIGNAL_DEVICE_MARKER_KEY, nextMarker)
  }

  _globalStore = new VostokSignalStore(identityKeyPair, registrationId)
  return _globalStore
}

export function resetSignalStore(): void {
  _globalStore = null
}
