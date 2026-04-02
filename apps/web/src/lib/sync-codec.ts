/**
 * Sync codec for device-to-device history sync.
 *
 * Chunks are JSON-encoded for simplicity (MessagePack can be added later for
 * compactness). Each chunk is encrypted with a shared sync session key derived
 * via X3DH between the two devices.
 */

import type { CachedMessage, CachedConversation, CachedContact } from './message-cache.ts'

// ── Types ─────────────────────────────────────────────────────────────────

export type SyncChunkType = 'conversations' | 'messages' | 'contacts'

export interface SyncChunk {
  type: SyncChunkType
  sequence: number
  data: CachedConversation[] | CachedMessage[] | CachedContact[]
  chatId?: string             // For message chunks: which conversation
  isLast: boolean             // Last chunk of this type
}

export interface SyncProgress {
  synced: number
  total: number
  currentType: SyncChunkType
  currentConversation?: string
}

// ── Encoding / Decoding ───────────────────────────────────────────────────

export function encodeSyncChunk(chunk: SyncChunk): string {
  return JSON.stringify(chunk)
}

export function decodeSyncChunk(encoded: string): SyncChunk {
  return JSON.parse(encoded) as SyncChunk
}

// ── Encryption helpers ────────────────────────────────────────────────────

/**
 * Derive a sync session key from a shared secret (from X3DH key exchange).
 * Uses HKDF via SubtleCrypto.
 */
export async function deriveSyncKey(sharedSecret: ArrayBuffer): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    'HKDF',
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('vostok-device-sync-v1'),
      info: new TextEncoder().encode('sync-session-key'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt a sync chunk with the session key.
 */
export async function encryptSyncChunk(
  key: CryptoKey,
  chunk: SyncChunk
): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(encodeSyncChunk(chunk))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  )

  return {
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(ciphertext),
  }
}

/**
 * Decrypt a sync chunk with the session key.
 */
export async function decryptSyncChunk(
  key: CryptoKey,
  iv: string,
  ciphertext: string
): Promise<SyncChunk> {
  const ivBytes = base64ToArrayBuffer(iv)
  const ciphertextBytes = base64ToArrayBuffer(ciphertext)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    ciphertextBytes
  )

  const decoded = new TextDecoder().decode(plaintext)
  return decodeSyncChunk(decoded)
}

// ── Chunking helpers ──────────────────────────────────────────────────────

const CHUNK_SIZE = 200 // Messages per chunk

/**
 * Split a list of messages into chunks for streaming.
 */
export function chunkMessages(
  chatId: string,
  messages: CachedMessage[],
  startSequence: number
): SyncChunk[] {
  const chunks: SyncChunk[] = []

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const slice = messages.slice(i, i + CHUNK_SIZE)
    const isLast = i + CHUNK_SIZE >= messages.length

    chunks.push({
      type: 'messages',
      sequence: startSequence + chunks.length,
      data: slice,
      chatId,
      isLast,
    })
  }

  // Handle empty messages case
  if (chunks.length === 0) {
    chunks.push({
      type: 'messages',
      sequence: startSequence,
      data: [],
      chatId,
      isLast: true,
    })
  }

  return chunks
}

// ── Base64 utilities ──────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}
