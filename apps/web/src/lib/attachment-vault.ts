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

export async function generateAttachmentThumbnailDataUrl(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    return null
  }

  const objectUrl = URL.createObjectURL(file)

  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    if (!context) {
      return null
    }

    const maxEdge = 280

    if (file.type.startsWith('image/')) {
      const image = await loadImage(objectUrl)
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height))
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
    } else {
      const video = await loadVideoFrame(objectUrl)
      const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
    }

    return canvas.toDataURL('image/jpeg', 0.78)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function generateAttachmentWaveform(file: File): Promise<number[] | null> {
  if (!file.type.startsWith('audio/')) {
    return null
  }

  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
    return null
  }

  let audioContext: AudioContext | null = null

  try {
    audioContext = new window.AudioContext()
    const audioBuffer = await audioContext.decodeAudioData(await file.arrayBuffer())
    const channel = audioBuffer.getChannelData(0)
    const samples = 24
    const blockSize = Math.max(1, Math.floor(channel.length / samples))
    const waveform: number[] = []

    for (let index = 0; index < samples; index += 1) {
      const start = index * blockSize
      const end = Math.min(channel.length, start + blockSize)
      let peak = 0

      for (let cursor = start; cursor < end; cursor += 1) {
        peak = Math.max(peak, Math.abs(channel[cursor] ?? 0))
      }

      waveform.push(Math.max(0.08, Math.min(1, peak)))
    }

    return waveform
  } catch {
    return null
  } finally {
    if (audioContext) {
      await audioContext.close()
    }
  }
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

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to render an attachment thumbnail.'))
    image.src = src
  })
}

async function loadVideoFrame(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.onloadeddata = () => resolve(video)
    video.onerror = () => reject(new Error('Failed to render a video attachment thumbnail.'))
    video.src = src
  })
}
