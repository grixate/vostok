import type { ChatMessage, RecipientDevice } from './api'
import { base64ToBytes, bytesToBase64 } from './base64'
import {
  decryptMessageWithSessions,
  isSessionHeader
} from './chat-session-vault'
import { bootstrapSecureStore, persistSecureStoreValue } from './secure-kv-store'

const LEGACY_MESSAGE_KEY_STORAGE = 'vostok.message-key'
const CONTENT_IV_BYTES = 12
const WRAP_IV_BYTES = 12
const ENVELOPE_ALGORITHM = 'vostok-ecdh-p256-aesgcm-v1'
const GROUP_SENDER_KEY_ALGORITHM = 'vostok-group-sender-key-v1'
const GROUP_SENDER_KEY_WRAP_ALGORITHM = 'vostok-group-sender-key-wrap-v1'
const GROUP_SENDER_KEY_RING_PREFIX = 'vostok.group-sender-key.'
const GROUP_SENDER_KEY_ACTIVE_PREFIX = 'vostok.group-sender-key.active.'

void bootstrapSecureStore([
  GROUP_SENDER_KEY_RING_PREFIX,
  GROUP_SENDER_KEY_ACTIVE_PREFIX,
  LEGACY_MESSAGE_KEY_STORAGE
])

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

type GroupSenderKeyHeader = {
  algorithm: string
  chat_id: string
  key_id: string
  epoch: number
  content_iv: string
}

type WrappedGroupSenderKeyEnvelope = {
  algorithm: string
  ephemeral_public_key: string
  wrap_iv: string
  wrapped_key: string
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

export function storeGroupSenderKeyMaterial(chatId: string, keyId: string, keyMaterialBase64: string): void {
  const normalizedChatId = chatId.trim()
  const normalizedKeyId = keyId.trim()

  if (!normalizedChatId || !normalizedKeyId || !keyMaterialBase64.trim()) {
    return
  }

  const ring = readGroupSenderKeyRing(normalizedChatId)
  ring[normalizedKeyId] = keyMaterialBase64.trim()
  writeGroupSenderKeyRing(normalizedChatId, ring)
}

export function setActiveGroupSenderKey(chatId: string, keyId: string, epoch: number): void {
  const normalizedChatId = chatId.trim()
  const normalizedKeyId = keyId.trim()

  if (!normalizedChatId || !normalizedKeyId) {
    return
  }

  const normalizedEpoch = Number.isInteger(epoch) && epoch >= 0 ? epoch : 0
  persistSecureStoreValue(
    `${GROUP_SENDER_KEY_ACTIVE_PREFIX}${normalizedChatId}`,
    JSON.stringify({
      key_id: normalizedKeyId,
      epoch: normalizedEpoch
    })
  )
}

export function getActiveGroupSenderKey(chatId: string): { key_id: string; epoch: number } | null {
  const normalizedChatId = chatId.trim()

  if (!normalizedChatId) {
    return null
  }

  const raw = window.localStorage.getItem(`${GROUP_SENDER_KEY_ACTIVE_PREFIX}${normalizedChatId}`)

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<{ key_id: string; epoch: number }>

    if (typeof parsed.key_id !== 'string' || parsed.key_id.trim() === '') {
      return null
    }

    return {
      key_id: parsed.key_id.trim(),
      epoch:
        typeof parsed.epoch === 'number' && Number.isInteger(parsed.epoch) && parsed.epoch >= 0
          ? parsed.epoch
          : 0
    }
  } catch {
    return null
  }
}

export async function wrapGroupSenderKeyForRecipients(
  keyMaterialBase64: string,
  recipientDevices: RecipientDevice[]
): Promise<Record<string, string>> {
  ensureWebCrypto()

  if (recipientDevices.length === 0) {
    return {}
  }

  const keyMaterial = base64ToBytes(keyMaterialBase64)
  const ephemeralKeyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveBits']
  )
  const ephemeralPublicKey = await window.crypto.subtle.exportKey('raw', ephemeralKeyPair.publicKey)
  const ephemeralPublicKeyBytes = new Uint8Array(ephemeralPublicKey)

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
      const wrapKey = await deriveWrapKey(ephemeralKeyPair.privateKey, publicKey, ephemeralPublicKeyBytes)
      const wrapIv = window.crypto.getRandomValues(new Uint8Array(WRAP_IV_BYTES))
      const wrappedKey = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(wrapIv) },
        wrapKey,
        toArrayBuffer(keyMaterial)
      )

      const envelope: WrappedGroupSenderKeyEnvelope = {
        algorithm: GROUP_SENDER_KEY_WRAP_ALGORITHM,
        ephemeral_public_key: bytesToBase64(ephemeralPublicKeyBytes),
        wrap_iv: bytesToBase64(wrapIv),
        wrapped_key: bytesToBase64(wrappedKey)
      }

      return [
        recipientDevice.device_id,
        bytesToBase64(new TextEncoder().encode(JSON.stringify(envelope)))
      ] as const
    })
  )

  return Object.fromEntries(wrappedEntries)
}

export async function storeInboundGroupSenderKeys(
  chatId: string,
  senderKeys: Array<{ key_id: string; wrapped_sender_key: string; status?: string }>,
  encryptionPrivateKeyPkcs8Base64?: string
): Promise<string[]> {
  const normalizedChatId = chatId.trim()

  if (!normalizedChatId || senderKeys.length === 0) {
    return []
  }

  const ring = readGroupSenderKeyRing(normalizedChatId)
  const importedKeyIds: string[] = []

  for (const senderKey of senderKeys) {
    if (
      senderKey.status &&
      senderKey.status !== 'active' &&
      senderKey.status !== 'superseded'
    ) {
      continue
    }

    const keyId = senderKey.key_id.trim()
    const wrappedSenderKey = senderKey.wrapped_sender_key.trim()

    if (!keyId || !wrappedSenderKey) {
      continue
    }

    const keyMaterial = await unwrapGroupSenderKeyEnvelope(
      wrappedSenderKey,
      encryptionPrivateKeyPkcs8Base64
    )

    if (!keyMaterial) {
      continue
    }

    ring[keyId] = keyMaterial
    importedKeyIds.push(keyId)
  }

  writeGroupSenderKeyRing(normalizedChatId, ring)
  return importedKeyIds
}

export async function encryptMessageWithGroupSenderKey(
  plaintext: string,
  chatId: string,
  keyId: string,
  epoch: number
): Promise<{
  ciphertext: string
  header: string
  crypto_scheme: 'group_sender_key_v1'
  sender_key_id: string
  sender_key_epoch: number
}> {
  ensureWebCrypto()

  const normalizedChatId = chatId.trim()
  const normalizedKeyId = keyId.trim()

  if (!normalizedChatId || !normalizedKeyId) {
    throw new Error('A chat id and sender key id are required for group sender-key encryption.')
  }

  const ring = readGroupSenderKeyRing(normalizedChatId)
  const keyMaterialBase64 = ring[normalizedKeyId]

  if (!keyMaterialBase64) {
    throw new Error('No local sender key material is available for this group key id.')
  }

  const contentIv = window.crypto.getRandomValues(new Uint8Array(CONTENT_IV_BYTES))
  const key = await importAesKey(base64ToBytes(keyMaterialBase64), ['encrypt'])
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(contentIv) },
    key,
    encoded
  )

  const header = bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({
        algorithm: GROUP_SENDER_KEY_ALGORITHM,
        chat_id: normalizedChatId,
        key_id: normalizedKeyId,
        epoch: Number.isInteger(epoch) && epoch >= 0 ? epoch : 0,
        content_iv: bytesToBase64(contentIv)
      } satisfies GroupSenderKeyHeader)
    )
  )

  return {
    ciphertext: bytesToBase64(ciphertext),
    header,
    crypto_scheme: 'group_sender_key_v1',
    sender_key_id: normalizedKeyId,
    sender_key_epoch: Number.isInteger(epoch) && epoch >= 0 ? epoch : 0
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

  if (message.header && message.chat_id && isGroupSenderKeyHeader(message.header)) {
    return decryptGroupSenderMessage(message)
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

async function decryptGroupSenderMessage(message: ChatMessage): Promise<string> {
  const header = parseGroupSenderKeyHeader(message.header)

  if (!header) {
    throw new Error('Group sender-key header is invalid.')
  }

  const ring = readGroupSenderKeyRing(header.chat_id)
  const keyMaterialBase64 = ring[header.key_id]

  if (!keyMaterialBase64) {
    throw new Error('No local group sender key is available for this message key id.')
  }

  const key = await importAesKey(base64ToBytes(keyMaterialBase64), ['decrypt'])
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(header.content_iv)) },
    key,
    toArrayBuffer(base64ToBytes(message.ciphertext))
  )

  return new TextDecoder().decode(plaintext)
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

async function unwrapGroupSenderKeyEnvelope(
  wrappedSenderKeyBase64: string,
  encryptionPrivateKeyPkcs8Base64?: string
): Promise<string | null> {
  const envelope = parseWrappedGroupSenderKeyEnvelope(wrappedSenderKeyBase64)

  if (!envelope) {
    return wrappedSenderKeyBase64
  }

  if (!encryptionPrivateKeyPkcs8Base64) {
    return null
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
  const ephemeralPublicKeyBytes = base64ToBytes(envelope.ephemeral_public_key)
  const ephemeralPublicKey = await window.crypto.subtle.importKey(
    'raw',
    toArrayBuffer(ephemeralPublicKeyBytes),
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false,
    []
  )
  const wrapKey = await deriveWrapKey(privateKey, ephemeralPublicKey, ephemeralPublicKeyBytes)
  const unwrappedKey = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(envelope.wrap_iv)) },
    wrapKey,
    toArrayBuffer(base64ToBytes(envelope.wrapped_key))
  )

  return bytesToBase64(unwrappedKey)
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
  persistSecureStoreValue(LEGACY_MESSAGE_KEY_STORAGE, serialized)

  return importAesKey(rawKey, ['encrypt', 'decrypt'])
}

function isEnvelopeHeader(headerBase64: string): boolean {
  return parseHeader(headerBase64)?.algorithm === ENVELOPE_ALGORITHM
}

function isGroupSenderKeyHeader(headerBase64: string): boolean {
  return parseGroupSenderKeyHeader(headerBase64)?.algorithm === GROUP_SENDER_KEY_ALGORITHM
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

function parseGroupSenderKeyHeader(headerBase64: string | null): GroupSenderKeyHeader | null {
  if (!headerBase64) {
    return null
  }

  try {
    const raw = new TextDecoder().decode(base64ToBytes(headerBase64))
    const parsed = JSON.parse(raw) as Partial<GroupSenderKeyHeader>

    if (
      parsed.algorithm !== GROUP_SENDER_KEY_ALGORITHM ||
      typeof parsed.chat_id !== 'string' ||
      typeof parsed.key_id !== 'string' ||
      typeof parsed.content_iv !== 'string'
    ) {
      return null
    }

    return {
      algorithm: parsed.algorithm,
      chat_id: parsed.chat_id,
      key_id: parsed.key_id,
      content_iv: parsed.content_iv,
      epoch:
        typeof parsed.epoch === 'number' && Number.isInteger(parsed.epoch) && parsed.epoch >= 0
          ? parsed.epoch
          : 0
    }
  } catch {
    return null
  }
}

function parseWrappedGroupSenderKeyEnvelope(
  payloadBase64: string
): WrappedGroupSenderKeyEnvelope | null {
  try {
    const raw = new TextDecoder().decode(base64ToBytes(payloadBase64))
    const envelope = JSON.parse(raw) as Partial<WrappedGroupSenderKeyEnvelope>

    if (
      envelope.algorithm !== GROUP_SENDER_KEY_WRAP_ALGORITHM ||
      typeof envelope.ephemeral_public_key !== 'string' ||
      typeof envelope.wrap_iv !== 'string' ||
      typeof envelope.wrapped_key !== 'string'
    ) {
      return null
    }

    return {
      algorithm: envelope.algorithm,
      ephemeral_public_key: envelope.ephemeral_public_key,
      wrap_iv: envelope.wrap_iv,
      wrapped_key: envelope.wrapped_key
    }
  } catch {
    return null
  }
}

function readGroupSenderKeyRing(chatId: string): Record<string, string> {
  const raw = window.localStorage.getItem(`${GROUP_SENDER_KEY_RING_PREFIX}${chatId}`)

  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[1].trim() !== ''
      )
    )
  } catch {
    return {}
  }
}

function writeGroupSenderKeyRing(chatId: string, ring: Record<string, string>): void {
  persistSecureStoreValue(`${GROUP_SENDER_KEY_RING_PREFIX}${chatId}`, JSON.stringify(ring))
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
