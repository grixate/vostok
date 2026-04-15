// Signal protocol bridge: the web client's only gateway to libsignal.
//
// All crypto operations are delegated to the Rust side (apps/desktop/src-tauri)
// over Tauri IPC. The Rust process owns the `signal.db` SQLite store and the
// identity keys; the web layer never sees key material.
//
// This module replaces the old `signal-keys.ts` / `signal-sessions.ts` /
// `signal-store.ts` trio that used `@privacyresearch/libsignal-protocol-typescript`.
// The function names mirror the old module's public API where possible so
// call-site migration is mechanical — but the `store` parameter is gone (the
// Rust side owns the store, scoped by server_id) and a `SignalContext` is
// threaded through instead.
//
// Phase 3: the wire format is now `signal-v2` end-to-end. Every prekey
// bundle ships a Kyber prekey (PQXDH) and every message header is labelled
// `signal-v2`. `signal-v1` is not accepted by the server anymore.

import { invoke } from '@tauri-apps/api/core'
import { base64ToBytes, bytesToBase64 } from './base64'

// ── Context ─────────────────────────────────────────────────────────────────

/**
 * Per-call context threaded through every bridge function. Tells the Rust
 * store which server's namespace to use and what the local device's address
 * name is (the Vostok device UUID — libsignal's address "name" field).
 */
export type SignalContext = {
  serverId: string
  localDeviceId: string
}

/** Transitional alias so legacy call sites can keep their type import names. */
export type VostokSignalStore = SignalContext

// ── Types matching the Rust DTOs ────────────────────────────────────────────

export type VostokPrekeyBundle = {
  device_id: string
  identity_public_key: string
  registration_id: number
  signed_prekey_id: number
  signed_prekey_public: string
  signed_prekey_signature: string
  one_time_prekey_id?: number
  one_time_prekey_public?: string
  // PQXDH — required under signal-v2. libsignal's `PreKeyBundle::new` on the
  // Rust side will refuse to build a bundle without these.
  kyber_prekey_id: number
  kyber_prekey_public: string
  kyber_prekey_signature: string
}

export type EncryptedEnvelope = {
  ciphertext: string
  header: string
  recipient_envelopes: Record<string, string>
  crypto_scheme: 'signal-v2'
}

/** Shape returned by `signal_register_identity` on the Rust side. */
export type RegisteredDeviceKeys = {
  registration_id: number
  identity_public_key_b64: string
  signed_prekey: {
    key_id: number
    public_key_b64: string
    signature_b64: string
  }
  one_time_prekeys: Array<{ key_id: number; public_key_b64: string }>
  kyber_prekey: {
    key_id: number
    public_key_b64: string
    signature_b64: string
  }
}

// ── Device registration & rotation ──────────────────────────────────────────

/**
 * Generate a fresh identity key pair, registration id, signed prekey, N
 * one-time prekeys, and a Kyber prekey. Everything is persisted inside the
 * Rust store — the return value contains only the publishable public keys
 * that go into the server's `POST /api/v1/prekey/publish` payload.
 */
export async function registerDeviceKeys(
  serverId: string,
  oneTimeCount = 16
): Promise<RegisteredDeviceKeys> {
  return invoke<RegisteredDeviceKeys>('signal_register_identity', {
    serverId,
    oneTimeCount
  })
}

/** Wipe every Signal table row for a given server_id. Use on logout. */
export async function wipeSignalStore(serverId: string): Promise<void> {
  await invoke('signal_wipe_all', { serverId })
}

// ── Session establishment ───────────────────────────────────────────────────

export async function buildSession(
  ctx: SignalContext,
  remoteDeviceId: string,
  prekeyBundle: VostokPrekeyBundle
): Promise<void> {
  await invoke('signal_process_prekey_bundle', {
    serverId: ctx.serverId,
    addressName: remoteDeviceId,
    bundle: {
      device_id: toDeviceIdNumber(remoteDeviceId),
      registration_id: prekeyBundle.registration_id,
      identity_public_key_b64: prekeyBundle.identity_public_key,
      signed_prekey_id: prekeyBundle.signed_prekey_id,
      signed_prekey_public_b64: prekeyBundle.signed_prekey_public,
      signed_prekey_signature_b64: prekeyBundle.signed_prekey_signature,
      one_time_prekey_id: prekeyBundle.one_time_prekey_id ?? null,
      one_time_prekey_public_b64: prekeyBundle.one_time_prekey_public ?? null,
      kyber_prekey_id: prekeyBundle.kyber_prekey_id,
      kyber_prekey_public_b64: prekeyBundle.kyber_prekey_public,
      kyber_prekey_signature_b64: prekeyBundle.kyber_prekey_signature
    }
  })
}

/**
 * Legacy `hasSession` check. The old JS store could probe whether a session
 * existed synchronously from localStorage; the Rust store could expose the
 * same via a dedicated command, but in practice callers only use it as a
 * short-circuit ("skip building if we already have one"). `buildSession`
 * itself is idempotent when called on an established session, so we always
 * return `false` and let the caller unconditionally attempt a build when a
 * bundle is available. This is semantically equivalent for all current
 * call sites.
 *
 * TODO Phase 2b: add a real `signal_has_session` command for callers that
 * want to gate a prekey fetch on session presence.
 */
export async function hasSession(
  _ctx: SignalContext,
  _remoteDeviceId: string
): Promise<boolean> {
  return false
}

export async function ensureSessionForDevice(
  ctx: SignalContext,
  remoteDeviceId: string,
  prekeyBundle?: VostokPrekeyBundle | null
): Promise<boolean> {
  if (!prekeyBundle) {
    return false
  }
  await buildSession(ctx, remoteDeviceId, prekeyBundle)
  return true
}

// ── Encrypt ─────────────────────────────────────────────────────────────────

export async function encryptForDevice(
  ctx: SignalContext,
  remoteDeviceId: string,
  plaintext: string
): Promise<{ body: string; type: number }> {
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const plaintextB64 = bytesToBase64(plaintextBytes)

  const result = await invoke<{ message_type: number; ciphertext_b64: string }>(
    'signal_encrypt',
    {
      serverId: ctx.serverId,
      localName: ctx.localDeviceId,
      localDeviceId: 1,
      addressName: remoteDeviceId,
      deviceId: toDeviceIdNumber(remoteDeviceId),
      plaintextB64
    }
  )

  return { body: result.ciphertext_b64, type: result.message_type }
}

export async function encryptMessage(
  ctx: SignalContext,
  recipientDevices: Array<{
    deviceId: string
    prekeyBundle?: VostokPrekeyBundle
  }>,
  plaintext: string
): Promise<EncryptedEnvelope> {
  const envelopes: Record<string, string> = {}
  const typeMap: Record<string, number> = {}

  for (const { deviceId, prekeyBundle } of recipientDevices) {
    // Sender never encrypts for their own device — own-message display uses
    // the sent-plaintext cache. A placeholder envelope keeps the server's
    // recipient validation happy.
    if (deviceId === ctx.localDeviceId) {
      envelopes[deviceId] = btoa('self')
      typeMap[deviceId] = 1
      continue
    }

    if (prekeyBundle) {
      await buildSession(ctx, deviceId, prekeyBundle)
    }

    const result = await encryptForDevice(ctx, deviceId, plaintext)
    envelopes[deviceId] = result.body
    typeMap[deviceId] = result.type
  }

  const header = btoa(
    JSON.stringify({
      algorithm: 'signal-v2',
      type_map: typeMap,
      kyber: true
    })
  )

  return {
    ciphertext: Object.values(envelopes)[0] ?? '',
    header,
    recipient_envelopes: envelopes,
    crypto_scheme: 'signal-v2'
  }
}

// ── Decrypt ─────────────────────────────────────────────────────────────────

export async function decryptMessage(
  ctx: SignalContext,
  senderDeviceId: string,
  ciphertextBase64: string,
  messageType: number
): Promise<string> {
  const plaintextB64 = await invoke<string>('signal_decrypt', {
    serverId: ctx.serverId,
    localName: ctx.localDeviceId,
    localDeviceId: 1,
    addressName: senderDeviceId,
    deviceId: toDeviceIdNumber(senderDeviceId),
    messageType,
    ciphertextB64: ciphertextBase64
  })

  const bytes = base64ToBytes(plaintextB64)
  return new TextDecoder().decode(bytes)
}

// ── Media key material (call e2ee) ──────────────────────────────────────────

export function generateMediaKeyMaterial(): string {
  return bytesToBase64(window.crypto.getRandomValues(new Uint8Array(32)))
}

export function mediaKeyFingerprint(keyMaterialBase64: string): string {
  return Array.from(base64ToBytes(keyMaterialBase64).slice(0, 6))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(':')
}

export async function wrapMediaKeyForDevice(
  ctx: SignalContext,
  remoteDeviceId: string,
  keyMaterialBase64: string
): Promise<{ body: string; type: number }> {
  return encryptForDevice(ctx, remoteDeviceId, keyMaterialBase64)
}

export async function deriveGroupCallKey(
  ctx: SignalContext,
  participantDeviceIds: string[]
): Promise<{
  keyMaterialBase64: string
  wrappedKeys: Record<string, { body: string; type: number }>
}> {
  const keyMaterialBase64 = generateMediaKeyMaterial()
  const wrappedKeys: Record<string, { body: string; type: number }> = {}
  for (const deviceId of participantDeviceIds) {
    wrappedKeys[deviceId] = await wrapMediaKeyForDevice(
      ctx,
      deviceId,
      keyMaterialBase64
    )
  }
  return { keyMaterialBase64, wrappedKeys }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Vostok uses device UUIDs as the libsignal ProtocolAddress name and hardcodes
 * the numeric device_id to 1 — matching the convention the privacyresearch
 * port inherited. Keep that convention in the bridge.
 */
function toDeviceIdNumber(_deviceUuid: string): number {
  return 1
}
