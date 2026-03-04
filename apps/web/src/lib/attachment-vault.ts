import { base64ToBytes, bytesToBase64 } from './base64'

const CONTENT_IV_BYTES = 12

export type EncryptedAttachment = {
  ciphertextBase64: string
  contentKeyBase64: string
  ivBase64: string
  size: number
  contentType: string
}

export async function encryptAttachmentFile(file: File): Promise<EncryptedAttachment> {
  ensureWebCrypto()

  const contentKeyBytes = window.crypto.getRandomValues(new Uint8Array(32))
  const contentKey = await importAesKey(contentKeyBytes, ['encrypt'])
  const iv = window.crypto.getRandomValues(new Uint8Array(CONTENT_IV_BYTES))
  const fileBytes = new Uint8Array(await file.arrayBuffer())
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    contentKey,
    toArrayBuffer(fileBytes)
  )

  return {
    ciphertextBase64: bytesToBase64(ciphertext),
    contentKeyBase64: bytesToBase64(contentKeyBytes),
    ivBase64: bytesToBase64(iv),
    size: file.size,
    contentType: file.type || 'application/octet-stream'
  }
}

export async function decryptAttachmentFile(
  ciphertextBase64: string,
  contentKeyBase64: string,
  ivBase64: string,
  contentType: string
): Promise<Blob> {
  ensureWebCrypto()

  const key = await importAesKey(base64ToBytes(contentKeyBase64), ['decrypt'])
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(ivBase64)) },
    key,
    toArrayBuffer(base64ToBytes(ciphertextBase64))
  )

  return new Blob([plaintext], { type: contentType || 'application/octet-stream' })
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

function ensureWebCrypto() {
  if (!window.crypto?.subtle) {
    throw new Error('WebCrypto is not available in this browser.')
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
