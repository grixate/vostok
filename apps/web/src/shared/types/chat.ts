/**
 * Shared type aliases used across hooks and contexts.
 * These were previously defined inline in App.tsx.
 */

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
