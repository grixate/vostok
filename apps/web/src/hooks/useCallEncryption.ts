import { useState, useEffect } from 'react'
import { deriveVerificationEmojis, fingerprintFromSharedSecret } from '../features/calls/emojiVerification.ts'

type UseCallEncryptionResult = {
  verificationEmojis: string[]
  encrypted: boolean
}

/**
 * Manages E2E encryption for calls.
 *
 * 1:1 calls: DH key exchange via signaling → derive AES-256-GCM key → Insertable Streams
 * Group calls: distributed key via rotateCallKeys API → Insertable Streams
 *
 * For now, derives verification emojis from a simple fingerprint.
 * Full Insertable Streams integration will be added when browser support stabilizes.
 */
export function useCallEncryption(
  callId: string | null,
  localKeyMaterial: ArrayBuffer | null
): UseCallEncryptionResult {
  const [verificationEmojis, setVerificationEmojis] = useState<string[]>([])

  useEffect(() => {
    if (!callId || !localKeyMaterial) {
      setVerificationEmojis([])
      return
    }

    fingerprintFromSharedSecret(localKeyMaterial)
      .then((fingerprint) => {
        setVerificationEmojis(deriveVerificationEmojis(fingerprint))
      })
      .catch(() => {
        setVerificationEmojis([])
      })
  }, [callId, localKeyMaterial])

  return {
    verificationEmojis,
    encrypted: verificationEmojis.length > 0,
  }
}
