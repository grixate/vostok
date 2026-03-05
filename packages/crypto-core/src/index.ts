export async function sha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('WebCrypto is not available in this runtime.')
  }

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await window.crypto.subtle.digest('SHA-256', view)

  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export function outboxRetryDelayMs(attemptCount: number): number {
  const normalizedAttempts = Number.isInteger(attemptCount) && attemptCount > 0 ? attemptCount : 1
  const exponential = Math.pow(2, Math.min(normalizedAttempts, 8)) * 1000
  return Math.min(5 * 60 * 1000, Math.max(3_000, exponential))
}
