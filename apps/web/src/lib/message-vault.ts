import type { ChatMessage } from './api'
import { base64ToBytes } from './base64'
import { whenSecureStoreReady } from './secure-kv-store'
import { decryptMessage as signalDecrypt, type SignalContext } from './signal-bridge'

// Decryption entry point. The Vostok server accepts only `signal-v2` wire
// messages (PQXDH via libsignal on the Rust side). Legacy schemes
// (`signal-v1`, `group_sender_key_v1`, and the old P-256 envelope) are
// rendered as a placeholder — any historical rows with those scheme values
// are frozen as "older protocol version" on the client.
export async function decryptMessageText(
  message: ChatMessage,
  currentDeviceId: string,
  serverId?: string | null,
  _encryptionPrivateKeyPkcs8Base64?: string
): Promise<string> {
  // Plaintext messages (crypto_scheme: 'none') are just base64-encoded text.
  if (message.crypto_scheme === 'none') {
    return new TextDecoder().decode(base64ToBytes(message.ciphertext))
  }

  // Ensure IndexedDB → localStorage key restoration has finished before
  // proceeding. Historically some decryption paths pulled key material out
  // of localStorage and the bootstrap races against render; the
  // `whenSecureStoreReady` gate remains as defense-in-depth.
  await whenSecureStoreReady()

  if (message.crypto_scheme === 'signal-v2') {
    if (!serverId) {
      throw new Error('Signal message decryption requires a serverId.')
    }
    return decryptSignalMessage(message, currentDeviceId, serverId)
  }

  throw new Error('[Message encrypted with an older protocol version]')
}

async function decryptSignalMessage(
  message: ChatMessage,
  currentDeviceId: string,
  serverId: string
): Promise<string> {
  const ctx: SignalContext = { serverId, localDeviceId: currentDeviceId }
  const senderDeviceId = message.sender_device_id

  if (!senderDeviceId) {
    throw new Error('Signal message missing sender_device_id')
  }

  if (!currentDeviceId) {
    throw new Error('Signal message decryption requires the current device id.')
  }

  // Own outbound messages: the sender encrypted for their own device using
  // their own session. Decrypt from the recipient_envelopes using the
  // sender's address — libsignal holds the self-session state. If no
  // envelope exists for this device, let the error propagate so the
  // sent-plaintext cache in projectMessage() can handle it.
  //
  // The server delivers the device-specific envelope as `recipient_envelope`.
  // Fall back to the top-level `ciphertext` if no per-device envelope
  // exists (happens for direct chats where the server writes the first
  // envelope into the shared column).
  const ciphertext = message.recipient_envelope ?? message.ciphertext

  if (!ciphertext) {
    throw new Error('No encrypted envelope found for this device')
  }

  // Parse the header to find this device's ciphertext type (1 = Whisper,
  // 3 = PreKey). The header is a base64-encoded JSON blob emitted by
  // `encryptMessage` in signal-bridge.ts.
  let messageType = 1
  if (message.header) {
    try {
      const headerJson = JSON.parse(atob(message.header)) as {
        algorithm?: string
        type_map?: Record<string, number>
      }
      if (headerJson.type_map?.[currentDeviceId] !== undefined) {
        messageType = headerJson.type_map[currentDeviceId]
      } else if (!message.recipient_envelope && headerJson.type_map) {
        // Fallback: when decrypting the shared top-level ciphertext (no
        // device-specific envelope), use the first entry's type. We never
        // guess another device's type when a device-specific envelope
        // exists — doing so can corrupt the local ratchet and turn a
        // transient miss into a persistent MessageCounterError.
        const firstType = Object.values(headerJson.type_map)[0]
        if (firstType !== undefined) {
          messageType = firstType
        }
      } else if (headerJson.type_map && message.recipient_envelope) {
        throw new Error(
          `Signal message type_map is missing an entry for current device ${currentDeviceId}.`
        )
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Signal message type_map is missing an entry')
      ) {
        throw error
      }
      // If header parse fails, default to WhisperMessage.
    }
  }

  return signalDecrypt(ctx, senderDeviceId, ciphertext, messageType)
}
