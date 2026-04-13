import {
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
  FingerprintGenerator
} from '@privacyresearch/libsignal-protocol-typescript'
import type { DeviceType } from '@privacyresearch/libsignal-protocol-typescript'
import { VostokSignalStore, arrayBufferToBase64, base64ToArrayBuffer } from './signal-store'
import { base64ToBytes, bytesToBase64 } from './base64'

// ── Addressing ──────────────────────────────────────────────────────────────

export function deviceAddress(
  deviceId: string,
  deviceNumber: number = 1
): SignalProtocolAddress {
  return new SignalProtocolAddress(deviceId, deviceNumber)
}

// ── Session Establishment ───────────────────────────────────────────────────

export async function buildSession(
  store: VostokSignalStore,
  remoteDeviceId: string,
  prekeyBundle: VostokPrekeyBundle
): Promise<void> {
  const address = deviceAddress(remoteDeviceId)
  const builder = new SessionBuilder(store, address)

  const device: DeviceType = {
    identityKey: base64ToArrayBuffer(prekeyBundle.identity_public_key),
    signedPreKey: {
      keyId: prekeyBundle.signed_prekey_id,
      publicKey: base64ToArrayBuffer(prekeyBundle.signed_prekey_public),
      signature: base64ToArrayBuffer(prekeyBundle.signed_prekey_signature)
    },
    preKey: prekeyBundle.one_time_prekey_public
      ? {
          keyId: prekeyBundle.one_time_prekey_id!,
          publicKey: base64ToArrayBuffer(prekeyBundle.one_time_prekey_public)
        }
      : undefined,
    registrationId: prekeyBundle.registration_id
  }

  await builder.processPreKey(device)
}

export async function hasSession(
  store: VostokSignalStore,
  remoteDeviceId: string
): Promise<boolean> {
  const address = deviceAddress(remoteDeviceId)
  const cipher = new SessionCipher(store, address)
  return cipher.hasOpenSession()
}

export async function ensureSessionForDevice(
  store: VostokSignalStore,
  remoteDeviceId: string,
  prekeyBundle?: VostokPrekeyBundle | null
): Promise<boolean> {
  if (await hasSession(store, remoteDeviceId)) {
    return true
  }

  if (!prekeyBundle) {
    return false
  }

  await buildSession(store, remoteDeviceId, prekeyBundle)
  return true
}

// ── Encrypt ─────────────────────────────────────────────────────────────────

export async function encryptForDevice(
  store: VostokSignalStore,
  remoteDeviceId: string,
  plaintext: string
): Promise<{ body: string; type: number; registrationId?: number }> {
  const address = deviceAddress(remoteDeviceId)
  const cipher = new SessionCipher(store, address)
  const encoded = new TextEncoder().encode(plaintext)
  const result = await cipher.encrypt(
    encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
  )

  // The library returns body as a binary string (each char is a byte),
  // not as base64. Convert to proper base64.
  let bodyBase64: string
  const encryptedBody = result.body

  if (typeof encryptedBody === 'string') {
    const bytes = new Uint8Array(encryptedBody.length)
    for (let i = 0; i < encryptedBody.length; i++) {
      bytes[i] = encryptedBody.charCodeAt(i)
    }
    bodyBase64 = bytesToBase64(bytes)
  } else if (encryptedBody) {
    bodyBase64 = arrayBufferToBase64(encryptedBody as unknown as ArrayBuffer)
  } else {
    throw new Error(`Signal encryption produced an unsupported body for device ${remoteDeviceId}.`)
  }

  return {
    body: bodyBase64,
    type: result.type,
    registrationId: result.registrationId
  }
}

export async function encryptMessage(
  store: VostokSignalStore,
  currentDeviceId: string,
  recipientDevices: Array<{
    deviceId: string
    prekeyBundle?: VostokPrekeyBundle
  }>,
  plaintext: string
): Promise<EncryptedEnvelope> {
  const envelopes: Record<string, string> = {}
  const typeMap: Record<string, number> = {}

  for (const { deviceId, prekeyBundle } of recipientDevices) {
    // The sender can't encrypt for their own device (no self-session).
    // Insert a placeholder envelope so the server's envelope validation
    // passes — the sender reads back their own messages via the
    // sent-plaintext cache, never via Signal decryption.
    if (deviceId === currentDeviceId) {
      envelopes[deviceId] = btoa('self')
      typeMap[deviceId] = 1
      continue
    }

    if (!(await hasSession(store, deviceId)) && prekeyBundle) {
      await buildSession(store, deviceId, prekeyBundle)
    }

    const result = await encryptForDevice(store, deviceId, plaintext)
    envelopes[deviceId] = result.body
    typeMap[deviceId] = result.type
  }

  const header = btoa(JSON.stringify({
    algorithm: 'signal-v1',
    type_map: typeMap
  }))

  return {
    // The sender doesn't encrypt for themselves (sent-plaintext cache handles
    // own-message display). Use the first recipient's envelope as the top-level
    // ciphertext field (server fallback for devices not in recipient_envelopes).
    ciphertext: Object.values(envelopes)[0] ?? '',
    header,
    recipient_envelopes: envelopes,
    crypto_scheme: 'signal-v1'
  }
}

// ── Decrypt ─────────────────────────────────────────────────────────────────

export async function decryptMessage(
  store: VostokSignalStore,
  senderDeviceId: string,
  ciphertextBase64: string,
  messageType: number
): Promise<string> {
  const address = deviceAddress(senderDeviceId)
  const cipher = new SessionCipher(store, address)

  let plaintext: ArrayBuffer

  if (messageType === 3) {
    plaintext = await cipher.decryptPreKeyWhisperMessage(
      base64ToArrayBuffer(ciphertextBase64),
      'binary'
    )
  } else {
    plaintext = await cipher.decryptWhisperMessage(
      base64ToArrayBuffer(ciphertextBase64),
      'binary'
    )
  }

  return new TextDecoder().decode(plaintext)
}

// ── Media Key Exchange ──────────────────────────────────────────────────────

export function generateMediaKeyMaterial(): string {
  return bytesToBase64(window.crypto.getRandomValues(new Uint8Array(32)))
}

export function mediaKeyFingerprint(keyMaterialBase64: string): string {
  return Array.from(base64ToBytes(keyMaterialBase64).slice(0, 6))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(':')
}

export async function wrapMediaKeyForDevice(
  store: VostokSignalStore,
  remoteDeviceId: string,
  keyMaterialBase64: string
): Promise<{ body: string; type: number }> {
  const result = await encryptForDevice(store, remoteDeviceId, keyMaterialBase64)
  return {
    body: result.body,
    type: result.type
  }
}

/**
 * Generate a random group call key and encrypt it for each participant
 * via their pairwise Signal session.
 */
export async function deriveGroupCallKey(
  store: VostokSignalStore,
  participantDeviceIds: string[]
): Promise<{ keyMaterialBase64: string; wrappedKeys: Record<string, { body: string; type: number }> }> {
  const keyMaterialBase64 = generateMediaKeyMaterial()

  const wrappedKeys: Record<string, { body: string; type: number }> = {}

  for (const deviceId of participantDeviceIds) {
    wrappedKeys[deviceId] = await wrapMediaKeyForDevice(store, deviceId, keyMaterialBase64)
  }

  return { keyMaterialBase64, wrappedKeys }
}

// ── Safety Numbers ──────────────────────────────────────────────────────────

export { FingerprintGenerator }

// ── Types ───────────────────────────────────────────────────────────────────

export type VostokPrekeyBundle = {
  device_id: string
  identity_public_key: string
  registration_id: number
  signed_prekey_id: number
  signed_prekey_public: string
  signed_prekey_signature: string
  one_time_prekey_id?: number
  one_time_prekey_public?: string
}

export type EncryptedEnvelope = {
  ciphertext: string
  header: string
  recipient_envelopes: Record<string, string>
  crypto_scheme: 'signal-v1'
}
