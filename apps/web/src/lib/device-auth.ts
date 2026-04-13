import { base64ToBytes, bytesToBase64 } from './base64'

/**
 * Sign an authentication challenge with an Ed25519 private key.
 * This is used for device authentication (separate from Signal E2EE).
 */
export async function signChallenge(
  challengeBase64: string,
  privateKeyPkcs8Base64: string
): Promise<string> {
  if (!window.crypto?.subtle) {
    throw new Error('WebCrypto is not available in this browser.')
  }

  const privateKeyBytes = base64ToBytes(privateKeyPkcs8Base64)
  const challengeBytes = base64ToBytes(challengeBase64)

  const privateKey = await window.crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(privateKeyBytes),
    { name: 'Ed25519' },
    false,
    ['sign']
  )

  const signature = await window.crypto.subtle.sign(
    'Ed25519',
    privateKey,
    toArrayBuffer(challengeBytes)
  )

  return bytesToBase64(signature)
}

export async function signPayload(
  payloadBase64: string,
  privateKeyPkcs8Base64: string
): Promise<string> {
  if (!window.crypto?.subtle) {
    throw new Error('WebCrypto is not available in this browser.')
  }

  const privateKeyBytes = base64ToBytes(privateKeyPkcs8Base64)
  const payloadBytes = base64ToBytes(payloadBase64)

  const privateKey = await window.crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(privateKeyBytes),
    { name: 'Ed25519' },
    false,
    ['sign']
  )

  const signature = await window.crypto.subtle.sign('Ed25519', privateKey, toArrayBuffer(payloadBytes))
  return bytesToBase64(signature)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
