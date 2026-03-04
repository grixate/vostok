import { base64ToBytes, bytesToBase64 } from './base64'

export type DeviceIdentity = {
  signingPublicKeyBase64: string
  signingPrivateKeyPkcs8Base64: string
  encryptionPublicKeyBase64: string
  encryptionPrivateKeyPkcs8Base64: string
}

export type PrekeyPair = {
  publicKeyBase64: string
  privateKeyPkcs8Base64: string
}

export type SignedPrekeyPair = PrekeyPair & {
  signatureBase64: string
}

export type DevicePrekeys = {
  signedPrekey: SignedPrekeyPair
  oneTimePrekeys: PrekeyPair[]
}

export async function generateDeviceIdentity(): Promise<DeviceIdentity> {
  if (!window.crypto?.subtle) {
    throw new Error('WebCrypto is not available in this browser.')
  }

  const signingKeyPair = await window.crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  )
  const encryptionKeyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveBits']
  )
  const signingPublicKey = await window.crypto.subtle.exportKey('raw', signingKeyPair.publicKey)
  const signingPrivateKey = await window.crypto.subtle.exportKey('pkcs8', signingKeyPair.privateKey)
  const encryptionPublicKey = await window.crypto.subtle.exportKey('raw', encryptionKeyPair.publicKey)
  const encryptionPrivateKey = await window.crypto.subtle.exportKey('pkcs8', encryptionKeyPair.privateKey)

  return {
    signingPublicKeyBase64: bytesToBase64(signingPublicKey),
    signingPrivateKeyPkcs8Base64: bytesToBase64(signingPrivateKey),
    encryptionPublicKeyBase64: bytesToBase64(encryptionPublicKey),
    encryptionPrivateKeyPkcs8Base64: bytesToBase64(encryptionPrivateKey)
  }
}

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

export async function generateDevicePrekeys(
  signingPrivateKeyPkcs8Base64: string,
  oneTimePrekeyCount = 16
): Promise<DevicePrekeys> {
  ensureWebCrypto()

  const baseSignedPrekey = await generateEncryptionKeyPair()
  const signedPrekey = {
    ...baseSignedPrekey,
    signatureBase64: await signPayload(
      baseSignedPrekey.publicKeyBase64,
      signingPrivateKeyPkcs8Base64
    )
  }
  const oneTimePrekeys = await Promise.all(
    Array.from({ length: oneTimePrekeyCount }, () => generateEncryptionKeyPair())
  )

  return {
    signedPrekey,
    oneTimePrekeys
  }
}

export async function signPayload(
  payloadBase64: string,
  privateKeyPkcs8Base64: string
): Promise<string> {
  ensureWebCrypto()

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

async function generateEncryptionKeyPair(): Promise<PrekeyPair> {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveBits']
  )
  const publicKey = await window.crypto.subtle.exportKey('raw', keyPair.publicKey)
  const privateKey = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

  return {
    publicKeyBase64: bytesToBase64(publicKey),
    privateKeyPkcs8Base64: bytesToBase64(privateKey)
  }
}

function ensureWebCrypto() {
  if (!window.crypto?.subtle) {
    throw new Error('WebCrypto is not available in this browser.')
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
