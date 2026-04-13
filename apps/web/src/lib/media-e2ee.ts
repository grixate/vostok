import { base64ToBytes, bytesToBase64 } from './base64.ts'
import type { CallCapabilityState } from './call-runtime.ts'

export type MediaEncryptionState =
  | 'disabled'
  | 'negotiating'
  | 'encrypted'
  | 'verified'
  | 'error'

export type CallCapability = {
  state: CallCapabilityState
  reason: string | null
  transport: 'standard' | 'legacy' | 'unsupported'
  browserName: string
  hostKind: 'desktop' | 'browser'
}

type TestCallCapabilityWindow = Window & {
  __VOSTOK_TEST_CALL_CAPABILITY__?: CallCapability
}

type MutableKeyRef = {
  current: Uint8Array | null
}

type LegacyTransformEndpoint = {
  createEncodedStreams: () => {
    readable: ReadableStream<RTCEncodedAudioFrame | RTCEncodedVideoFrame>
    writable: WritableStream<RTCEncodedAudioFrame | RTCEncodedVideoFrame>
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function supportsLegacyEncodedStreamsFor(value: unknown): value is LegacyTransformEndpoint {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'createEncodedStreams' in value &&
      typeof (value as { createEncodedStreams?: unknown }).createEncodedStreams === 'function'
  )
}

function supportsStandardEncodedTransforms(): boolean {
  if (typeof window === 'undefined' || typeof window.Worker === 'undefined') {
    return false
  }

  const senderPrototype = window.RTCRtpSender?.prototype as
    | { transform?: unknown }
    | undefined
  const receiverPrototype = window.RTCRtpReceiver?.prototype as
    | { transform?: unknown }
    | undefined

  return (
    typeof window.RTCRtpScriptTransform === 'function' &&
    Boolean(senderPrototype && 'transform' in senderPrototype) &&
    Boolean(receiverPrototype && 'transform' in receiverPrototype)
  )
}

function supportsLegacyEncodedTransforms(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const senderPrototype = window.RTCRtpSender?.prototype as
    | { createEncodedStreams?: unknown }
    | undefined
  const receiverPrototype = window.RTCRtpReceiver?.prototype as
    | { createEncodedStreams?: unknown }
    | undefined

  return (
    typeof senderPrototype?.createEncodedStreams === 'function' &&
    typeof receiverPrototype?.createEncodedStreams === 'function'
  )
}

function detectBrowserName(): string {
  if (typeof navigator === 'undefined') {
    return 'Unknown browser'
  }

  const userAgent = navigator.userAgent

  if (/Edg\//.test(userAgent)) {
    return 'Microsoft Edge'
  }

  if (/Firefox\//.test(userAgent)) {
    return 'Firefox'
  }

  if (/CriOS\//.test(userAgent)) {
    return 'Chrome (iOS)'
  }

  if (/Chrome\//.test(userAgent) || /Chromium\//.test(userAgent)) {
    return 'Chrome'
  }

  if (/FxiOS\//.test(userAgent)) {
    return 'Firefox (iOS)'
  }

  if (/Version\/.*Safari\//.test(userAgent) || /Safari\//.test(userAgent)) {
    return 'Safari'
  }

  return 'Unknown browser'
}

export function getCallCapability(): CallCapability {
  const testOverride = typeof window !== 'undefined'
    ? (window as TestCallCapabilityWindow).__VOSTOK_TEST_CALL_CAPABILITY__
    : undefined

  if (testOverride) {
    return testOverride
  }

  const browserName = detectBrowserName()
  const hostKind =
    typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined'
      ? 'desktop'
      : 'browser'

  if (typeof window === 'undefined') {
    return {
      state: 'unsupported_browser',
      reason: 'Calls are unavailable because the browser environment is not ready yet.',
      transport: 'unsupported',
      browserName,
      hostKind
    }
  }

  if (!window.navigator?.mediaDevices?.getUserMedia) {
    return {
      state: 'unsupported_media_capture',
      reason: `${browserName} does not provide the required microphone/camera capture APIs for calls.`,
      transport: 'unsupported',
      browserName,
      hostKind
    }
  }

  if (!window.crypto?.subtle) {
    return {
      state: 'unsupported_browser',
      reason: `${browserName} does not provide the required Web Crypto APIs for encrypted calling.`,
      transport: 'unsupported',
      browserName,
      hostKind
    }
  }

  if (supportsStandardEncodedTransforms()) {
    return {
      state: 'supported',
      reason: null,
      transport: 'standard',
      browserName,
      hostKind
    }
  }

  if (typeof window.Worker === 'undefined') {
    return {
      state: 'unsupported_worker',
      reason: `${browserName} does not provide the worker support required for call media encryption.`,
      transport: 'unsupported',
      browserName,
      hostKind
    }
  }

  if (supportsLegacyEncodedTransforms()) {
    return {
      state: 'supported',
      reason: null,
      transport: 'legacy',
      browserName,
      hostKind
    }
  }

  return {
    state: 'unsupported_transform',
    reason: `${browserName} does not support the WebRTC encoded transform APIs required for encrypted calls on this app version.`,
    transport: 'unsupported',
    browserName,
    hostKind
  }
}

async function importFrameKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptFrameData(keyBytes: Uint8Array, data: ArrayBuffer): Promise<ArrayBuffer> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const key = await importFrameKey(keyBytes)
  const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  const payload = new Uint8Array(1 + iv.byteLength + ciphertext.byteLength)
  payload[0] = 1
  payload.set(iv, 1)
  payload.set(new Uint8Array(ciphertext), 1 + iv.byteLength)
  return payload.buffer
}

async function decryptFrameData(keyBytes: Uint8Array, data: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(data)

  if (bytes.byteLength <= 13 || bytes[0] !== 1) {
    throw new Error('Encoded frame is missing an E2EE envelope.')
  }

  const iv = bytes.slice(1, 13)
  const ciphertext = bytes.slice(13)
  const key = await importFrameKey(keyBytes)
  return window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
}

function createEncryptTransform(keyRef: MutableKeyRef) {
  return new TransformStream<
    RTCEncodedAudioFrame | RTCEncodedVideoFrame,
    RTCEncodedAudioFrame | RTCEncodedVideoFrame
  >({
    async transform(frame, controller) {
      const keyBytes = keyRef.current

      if (!keyBytes) {
        controller.enqueue(frame)
        return
      }

      frame.data = await encryptFrameData(keyBytes, frame.data)
      controller.enqueue(frame)
    }
  })
}

function createDecryptTransform(keyRef: MutableKeyRef) {
  return new TransformStream<
    RTCEncodedAudioFrame | RTCEncodedVideoFrame,
    RTCEncodedAudioFrame | RTCEncodedVideoFrame
  >({
    async transform(frame, controller) {
      const keyBytes = keyRef.current

      if (!keyBytes) {
        controller.enqueue(frame)
        return
      }

      frame.data = await decryptFrameData(keyBytes, frame.data)
      controller.enqueue(frame)
    }
  })
}

function createMediaE2eeWorker(): Worker {
  return new Worker(new URL('./media-e2ee-worker.ts', import.meta.url), { type: 'module' })
}

export class MediaE2eeController {
  private readonly keyRef: MutableKeyRef = { current: null }
  private worker: Worker | null = null
  private standardConnection: RTCPeerConnection | null = null
  private legacyConnection: RTCPeerConnection | null = null
  private standardKeyVersion = 0
  private standardSenderVersions = new WeakMap<RTCRtpSender, number>()
  private standardReceiverVersions = new WeakMap<RTCRtpReceiver, number>()
  private standardSenderPorts = new WeakMap<RTCRtpSender, MessagePort>()
  private standardReceiverPorts = new WeakMap<RTCRtpReceiver, MessagePort>()
  private attachedLegacySenders = new WeakSet<RTCRtpSender>()
  private attachedLegacyReceivers = new WeakSet<RTCRtpReceiver>()

  updateKey(keyMaterialBase64: string | null) {
    this.keyRef.current = keyMaterialBase64 ? base64ToBytes(keyMaterialBase64) : null
    this.standardKeyVersion += 1

    const message = { type: 'setKey', keyBase64: keyMaterialBase64 } as const

    if (this.standardConnection) {
      for (const sender of this.standardConnection.getSenders()) {
        this.standardSenderPorts.get(sender)?.postMessage(message)
      }

      for (const receiver of this.standardConnection.getReceivers()) {
        this.standardReceiverPorts.get(receiver)?.postMessage(message)
      }
    }
  }

  attach(connection: RTCPeerConnection | null) {
    if (!connection) {
      return
    }

    const capability = getCallCapability()

    if (capability.state !== 'supported') {
      return
    }

    if (capability.transport === 'standard') {
      this.attachStandardTransforms(connection)
      return
    }

    this.attachLegacyTransforms(connection)
  }

  teardown() {
    this.worker?.terminate()
    this.worker = null
    this.standardConnection = null
    this.legacyConnection = null
    this.standardSenderVersions = new WeakMap()
    this.standardReceiverVersions = new WeakMap()
    this.standardSenderPorts = new WeakMap()
    this.standardReceiverPorts = new WeakMap()
    this.attachedLegacySenders = new WeakSet()
    this.attachedLegacyReceivers = new WeakSet()
    this.keyRef.current = null
    this.standardKeyVersion = 0
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = createMediaE2eeWorker()
    }

    return this.worker
  }

  private attachStandardTransforms(connection: RTCPeerConnection) {
    const worker = this.ensureWorker()
    this.standardConnection = connection

    for (const sender of connection.getSenders()) {
      if (this.standardSenderVersions.get(sender) === this.standardKeyVersion) {
        continue
      }

      const previousPort = this.standardSenderPorts.get(sender)
      previousPort?.close()

      const channel = new MessageChannel()
      sender.transform = new RTCRtpScriptTransform(
        worker,
        {
          operation: 'encrypt',
          keyBase64: this.keyRef.current ? bytesToBase64(this.keyRef.current) : null,
          port: channel.port2
        },
        [channel.port2]
      )
      channel.port1.start()
      this.standardSenderPorts.set(sender, channel.port1)
      this.standardSenderVersions.set(sender, this.standardKeyVersion)
    }

    for (const receiver of connection.getReceivers()) {
      if (this.standardReceiverVersions.get(receiver) === this.standardKeyVersion) {
        continue
      }

      const previousPort = this.standardReceiverPorts.get(receiver)
      previousPort?.close()

      const channel = new MessageChannel()
      receiver.transform = new RTCRtpScriptTransform(
        worker,
        {
          operation: 'decrypt',
          keyBase64: this.keyRef.current ? bytesToBase64(this.keyRef.current) : null,
          port: channel.port2
        },
        [channel.port2]
      )
      channel.port1.start()
      this.standardReceiverPorts.set(receiver, channel.port1)
      this.standardReceiverVersions.set(receiver, this.standardKeyVersion)
    }
  }

  private attachLegacyTransforms(connection: RTCPeerConnection) {
    this.legacyConnection = connection

    for (const sender of connection.getSenders()) {
      if (this.attachedLegacySenders.has(sender) || !supportsLegacyEncodedStreamsFor(sender)) {
        continue
      }

      this.attachedLegacySenders.add(sender)
      const { readable, writable } = sender.createEncodedStreams()
      void readable.pipeThrough(createEncryptTransform(this.keyRef)).pipeTo(writable)
    }

    for (const receiver of connection.getReceivers()) {
      if (this.attachedLegacyReceivers.has(receiver) || !supportsLegacyEncodedStreamsFor(receiver)) {
        continue
      }

      this.attachedLegacyReceivers.add(receiver)
      const { readable, writable } = receiver.createEncodedStreams()
      void readable.pipeThrough(createDecryptTransform(this.keyRef)).pipeTo(writable)
    }
  }
}

export function supportsMediaE2EE(): boolean {
  return getCallCapability().state === 'supported'
}
