import type { SignedPrekeyPair, PrekeyPair } from './lib/device-auth'

export type AuthView = 'welcome' | 'register' | 'login' | 'link' | 'chat'

export type StoredDevice = {
  deviceId: string
  deviceName: string
  privateKeyPkcs8Base64: string
  publicKeyBase64: string
  encryptionPrivateKeyPkcs8Base64?: string
  encryptionPublicKeyBase64?: string
  signedPrekeyPublicKeyBase64?: string
  signedPrekeyPrivateKeyPkcs8Base64?: string
  signedPrekeys?: SignedPrekeyPair[]
  oneTimePrekeys?: PrekeyPair[]
  sessionExpiresAt: string
  sessionToken: string
  username: string
}

export type Banner = {
  tone: 'error' | 'info' | 'success'
  message: string
}

export type SafetyNumberEntry = {
  peerDeviceId: string
  peerUsername: string
  peerDeviceName: string
  label: string
  fingerprint: string
  verified: boolean
  verifiedAt: string | null
}

export type AttachmentDescriptor = {
  kind: 'attachment'
  uploadId: string
  fileName: string
  contentType: string
  size: number
  thumbnailDataUrl?: string
  waveform?: number[]
  contentKeyBase64: string
  ivBase64: string
}
