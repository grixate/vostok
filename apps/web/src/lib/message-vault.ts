import type { ChatMessage, RecipientDevice } from './api'
import { base64ToBytes, bytesToBase64 } from './base64'
import {
  decryptMessageWithSessions,
  isSessionHeader
} from './chat-session-vault'

const LEGACY_MESSAGE_KEY_STORAGE = 'vostok.message-key'
const CONTENT_IV_BYTES = 12
const WRAP_IV_BYTES = 12
const ENVELOPE_ALGORITHM = 'vostok-ecdh-p256-aesgcm-v1'

type EnvelopeHeader = {
  algorithm: string
  content_iv: string
  ephemeral_public_key: string
}

type EncryptedEnvelope = {
  ciphertext: string
  header: string
  recipient_envelopes: Record<string, string>
}

export async function encryptMessageEnvelope(
  plaintext: string,
  recipientDevices: RecipientDevice[]
): Promise<EncryptedEnvelope> {
  ensureWebCrypto()

  const contentKeyBytes = window.crypto.getRandomValues(new Uint8Array(32))
  const contentKey = await importAesKey(contentKeyBytes, ['encrypt'])
  const contentIv = window.crypto.getRandomValues(new Uint8Array(CONTENT_IV_BYTES))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(contentIv) },
    contentKey,
    encoded
  )

  const ephemeralKeyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveBits']
  )
  const ephemeralPublicKey = await window.crypto.subtle.exportKey('raw', ephemeralKeyPair.publicKey)
  const recipientEnvelopes = await wrapForRecipients(
    contentKeyBytes,
    ephemeralKeyPair.privateKey,
    new Uint8Array(ephemeralPublicKey),
    recipientDevices
  )

  return {
    ciphertext: bytesToBase64(ciphertext),
    header: encodeHeader({
      algorithm: ENVELOPE_ALGORITHM,
      content_iv: bytesToBase64(contentIv),
      ephemeral_public_key: bytesToBase64(ephemeralPublicKey)
    }),
    recipient_envelopes: recipientEnvelopes
  }
}

export async function encryptLegacyMessageText(plaintext: string): Promise<string> {
  ensureWebCrypto()

  const key = await getOrCreateLegacyMessageKey()
  const iv = window.crypto.getRandomValues(new Uint8Array(CONTENT_IV_BYTES))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    encoded
  )

  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.byteLength)

  return bytesToBase64(combined)
}

export async function decryptMessageText(
  message: ChatMessage,
  currentDeviceId: string,
  encryptionPrivateKeyPkcs8Base64?: string
): Promise<string> {
  if (message.header && message.recipient_envelope && isSessionHeader(message.header)) {
    return decryptMessageWithSessions(message, currentDeviceId)
  }

  if (
    encryptionPrivateKeyPkcs8Base64 &&
    message.header &&
    message.recipient_envelope &&
    isEnvelopeHeader(message.header)
  ) {
    return decryptRecipientEnvelope(message, encryptionPrivateKeyPkcs8Base64)
  }

  return decryptLegacyMessageText(message.ciphertext)
}

async function decryptRecipientEnvelope(
  message: ChatMessage,
  encryptionPrivateKeyPkcs8Base64: string
): Promise<string> {
  const header = parseHeader(message.header)

  if (!header) {
    throw new Error('Message header is invalid.')
  }

  const privateKey = await window.crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(base64ToBytes(encryptionPrivateKeyPkcs8Base64)),
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false,
    ['deriveBits']
  )
  const ephemeralPublicKey = await window.crypto.subtle.importKey(
    'raw',
    toArrayBuffer(base64ToBytes(header.ephemeral_public_key)),
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false,
    []
  )
  const wrapKey = await deriveWrapKey(privateKey, ephemeralPublicKey, base64ToBytes(header.ephemeral_public_key))
  const wrappedContentKey = base64ToBytes(message.recipient_envelope ?? '')

  if (wrappedContentKey.byteLength <= WRAP_IV_BYTES) {
    throw new Error('Recipient envelope is invalid.')
  }

  const wrapIv = wrappedContentKey.slice(0, WRAP_IV_BYTES)
  const wrappedKeyCiphertext = wrappedContentKey.slice(WRAP_IV_BYTES)
  const contentKeyBytes = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(wrapIv) },
    wrapKey,
    toArrayBuffer(wrappedKeyCiphertext)
  )
  const contentKey = await importAesKey(new Uint8Array(contentKeyBytes), ['decrypt'])
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(header.content_iv)) },
    contentKey,
    toArrayBuffer(base64ToBytes(message.ciphertext))
  )

  return new TextDecoder().decode(plaintext)
}

async function decryptLegacyMessageText(payloadBase64: string): Promise<string> {
  const combined = base64ToBytes(payloadBase64)

  if (combined.byteLength <= CONTENT_IV_BYTES) {
    throw new Error('Ciphertext payload is invalid.')
  }

  const iv = combined.slice(0, CONTENT_IV_BYTES)
  const ciphertext = combined.slice(CONTENT_IV_BYTES)
  const key = await getOrCreateLegacyMessageKey()
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext)
  )

  return new TextDecoder().decode(plaintext)
}

async function wrapForRecipients(
  contentKeyBytes: Uint8Array,
  ephemeralPrivateKey: CryptoKey,
  ephemeralPublicKeyBytes: Uint8Array,
  recipientDevices: RecipientDevice[]
): Promise<Record<string, string>> {
  const wrappedEntries = await Promise.all(
    recipientDevices.map(async (recipientDevice) => {
      const publicKey = await window.crypto.subtle.importKey(
        'raw',
        toArrayBuffer(base64ToBytes(recipientDevice.encryption_public_key)),
        {
          name: 'ECDH',
          namedCurve: 'P-256'
        },
        false,
        []
      )
      const wrapKey = await deriveWrapKey(ephemeralPrivateKey, publicKey, ephemeralPublicKeyBytes)
      const wrapIv = window.crypto.getRandomValues(new Uint8Array(WRAP_IV_BYTES))
      const wrappedKey = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(wrapIv) },
        wrapKey,
        toArrayBuffer(contentKeyBytes)
      )

      const envelope = new Uint8Array(wrapIv.byteLength + wrappedKey.byteLength)
      envelope.set(wrapIv, 0)
      envelope.set(new Uint8Array(wrappedKey), wrapIv.byteLength)

      return [recipientDevice.device_id, bytesToBase64(envelope)] as const
    })
  )

  return Object.fromEntries(wrappedEntries)
}

async function deriveWrapKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  ephemeralPublicKeyBytes: Uint8Array
): Promise<CryptoKey> {
  const sharedSecret = await window.crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: publicKey
    },
    privateKey,
    256
  )
  const wrapKeySeed = await window.crypto.subtle.digest(
    'SHA-256',
    toArrayBuffer(concatBytes(new Uint8Array(sharedSecret), ephemeralPublicKeyBytes))
  )

  return importAesKey(new Uint8Array(wrapKeySeed), ['encrypt', 'decrypt'])
}

async function importAesKey(rawKey: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    'raw',
    toArrayBuffer(rawKey),
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  )
}

async function getOrCreateLegacyMessageKey(): Promise<CryptoKey> {
  const existing = window.localStorage.getItem(LEGACY_MESSAGE_KEY_STORAGE)

  if (existing) {
    return importAesKey(base64ToBytes(existing), ['encrypt', 'decrypt'])
  }

  const rawKey = window.crypto.getRandomValues(new Uint8Array(32))
  const serialized = bytesToBase64(rawKey)
  window.localStorage.setItem(LEGACY_MESSAGE_KEY_STORAGE, serialized)

  return importAesKey(rawKey, ['encrypt', 'decrypt'])
}

function isEnvelopeHeader(headerBase64: string): boolean {
  return parseHeader(headerBase64)?.algorithm === ENVELOPE_ALGORITHM
}

function parseHeader(headerBase64: string | null): EnvelopeHeader | null {
  if (!headerBase64) {
    return null
  }

  try {
    const bytes = base64ToBytes(headerBase64)
    const raw = new TextDecoder().decode(bytes)
    const header = JSON.parse(raw) as Partial<EnvelopeHeader>

    if (
      header.algorithm !== ENVELOPE_ALGORITHM ||
      typeof header.content_iv !== 'string' ||
      typeof header.ephemeral_public_key !== 'string'
    ) {
      return null
    }

    return {
      algorithm: header.algorithm,
      content_iv: header.content_iv,
      ephemeral_public_key: header.ephemeral_public_key
    }
  } catch {
    return null
  }
}

function encodeHeader(header: EnvelopeHeader): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(header)))
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.byteLength + right.byteLength)
  merged.set(left, 0)
  merged.set(right, left.byteLength)
  return merged
}

function ensureWebCrypto() {
  if (!window.crypto?.subtle) {
    throw new Error('WebCrypto is not available in this browser.')
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
