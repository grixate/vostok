// Derive 4 verification emojis from a key fingerprint.
// Both parties should see the same emojis if the E2E encryption keys match.

const VERIFICATION_EMOJIS = [
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
  '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
  '🐧', '🐦', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗',
  '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜',
  '🪲', '🐢', '🐍', '🦎', '🐙', '🦑', '🦐', '🦀',
  '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊',
  '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏',
  '🐪', '🐫', '🦒', '🦘', '🦬', '🐃', '🐂', '🐄',
]

export function deriveVerificationEmojis(keyFingerprint: Uint8Array): string[] {
  const emojis: string[] = []
  for (let i = 0; i < 4; i++) {
    const byte = keyFingerprint[i % keyFingerprint.length] ?? 0
    emojis.push(VERIFICATION_EMOJIS[byte % VERIFICATION_EMOJIS.length])
  }
  return emojis
}

export async function fingerprintFromSharedSecret(sharedSecret: ArrayBuffer): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', sharedSecret)
  return new Uint8Array(hash).slice(0, 4)
}
