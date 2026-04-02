type EncodedFrame = RTCEncodedAudioFrame | RTCEncodedVideoFrame

type TransformOperation = 'encrypt' | 'decrypt'

type TransformOptions = {
  operation?: TransformOperation
  keyBase64?: string | null
  port?: MessagePort
}

type TransformMessage = {
  type: 'setKey'
  keyBase64: string | null
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function importFrameKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptFrameData(keyBytes: Uint8Array, data: ArrayBuffer): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await importFrameKey(keyBytes)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
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
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
}

function bindKeyPort(
  port: MessagePort | undefined,
  keyRef: { current: Uint8Array | null }
) {
  if (!port) {
    return
  }

  port.onmessage = (event: MessageEvent<TransformMessage>) => {
    if (event.data?.type !== 'setKey') {
      return
    }

    keyRef.current = event.data.keyBase64 ? base64ToBytes(event.data.keyBase64) : null
  }
  port.start()
}

function createFrameTransform(
  operation: TransformOperation,
  keyRef: { current: Uint8Array | null }
) {
  return new TransformStream<EncodedFrame, EncodedFrame>({
    async transform(frame, controller) {
      const keyBytes = keyRef.current

      if (!keyBytes) {
        controller.enqueue(frame)
        return
      }

      frame.data =
        operation === 'encrypt'
          ? await encryptFrameData(keyBytes, frame.data)
          : await decryptFrameData(keyBytes, frame.data)

      controller.enqueue(frame)
    }
  })
}

self.addEventListener('rtctransform', (event) => {
  const transformEvent = event as RTCRtpTransformEvent
  const transformer = transformEvent.transformer
  const options = (transformer.options ?? {}) as TransformOptions
  const keyRef = {
    current: options.keyBase64 ? base64ToBytes(options.keyBase64) : null
  }

  bindKeyPort(options.port, keyRef)

  void transformer.readable
    .pipeThrough(createFrameTransform(options.operation ?? 'decrypt', keyRef))
    .pipeTo(transformer.writable)
    .catch(() => undefined)
})
