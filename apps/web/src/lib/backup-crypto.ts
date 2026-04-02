// ---------------------------------------------------------------------------
// .vostok backup file — encryption / decryption / format
// ---------------------------------------------------------------------------
//
// File layout:
//   Bytes 0-7:      Magic "VOSTOK01" (ASCII)
//   Bytes 8-11:     Version uint32 BE (1)
//   Bytes 12-15:    Salt length uint32 BE (N)
//   Bytes 16..16+N: Salt (random, for PBKDF2)
//   Rest:           12-byte AES-GCM nonce ‖ ciphertext
//
// Encryption: PBKDF2-SHA256 (600 000 iterations) → AES-256-GCM

export type BackupCredentialMode = 'addresses_only' | 'quick_restore' | 'full_credentials'

export type BackupServerEntry = {
  url: string
  username: string
  label: string
  color: string
  sort_order: number
  credentials: {
    refresh_token: string | null
    refresh_token_expires_at: string | null
    password: string | null
  }
}

export type BackupPayload = {
  version: number
  created_at: string
  expires_at: string
  credential_mode: BackupCredentialMode
  servers: BackupServerEntry[]
}

// ---- constants ------------------------------------------------------------

const MAGIC = 'VOSTOK01'
const FORMAT_VERSION = 1
const SALT_BYTES = 32
const PBKDF2_ITERATIONS = 600_000
const IV_BYTES = 12

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// ---- key derivation -------------------------------------------------------

async function deriveBackupKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ---- encrypt / decrypt primitives -----------------------------------------

async function encrypt(plaintext: string, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  )
  const result = new Uint8Array(IV_BYTES + ciphertext.byteLength)
  result.set(iv, 0)
  result.set(new Uint8Array(ciphertext), IV_BYTES)
  return result
}

async function decrypt(data: Uint8Array, key: CryptoKey): Promise<string> {
  const iv = data.slice(0, IV_BYTES)
  const ciphertext = data.slice(IV_BYTES)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  )
  return decoder.decode(plaintext)
}

// ---- file serialisation ---------------------------------------------------

function serializeHeader(salt: Uint8Array): Uint8Array {
  const magic = encoder.encode(MAGIC) // 8 bytes
  const header = new Uint8Array(8 + 4 + 4 + salt.byteLength)
  const view = new DataView(header.buffer)

  header.set(magic, 0)
  view.setUint32(8, FORMAT_VERSION, false)   // big-endian
  view.setUint32(12, salt.byteLength, false) // big-endian
  header.set(salt, 16)

  return header
}

function parseHeader(file: Uint8Array): { salt: Uint8Array; body: Uint8Array } {
  if (file.byteLength < 16) {
    throw new Error('File too small to be a valid backup')
  }

  const magic = decoder.decode(file.slice(0, 8))
  if (magic !== MAGIC) {
    throw new Error('Not a valid Vostok backup file')
  }

  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const version = view.getUint32(8, false)
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported backup version: ${version}`)
  }

  const saltLength = view.getUint32(12, false)
  if (file.byteLength < 16 + saltLength) {
    throw new Error('File truncated — salt missing')
  }

  const salt = file.slice(16, 16 + saltLength)
  const body = file.slice(16 + saltLength)

  if (body.byteLength < IV_BYTES + 1) {
    throw new Error('File truncated — encrypted data missing')
  }

  return { salt, body }
}

// ---- public API -----------------------------------------------------------

/** Returns true if the first 8 bytes are the VOSTOK01 magic. */
export function validateBackupMagic(file: Uint8Array): boolean {
  if (file.byteLength < 8) return false
  return decoder.decode(file.slice(0, 8)) === MAGIC
}

/** Encrypt a backup payload and produce the .vostok file bytes. */
export async function exportBackupFile(
  payload: BackupPayload,
  passphrase: string,
): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await deriveBackupKey(passphrase, salt)
  const encrypted = await encrypt(JSON.stringify(payload), key)
  const header = serializeHeader(salt)

  const file = new Uint8Array(header.byteLength + encrypted.byteLength)
  file.set(header, 0)
  file.set(encrypted, header.byteLength)
  return file
}

/**
 * Decrypt a .vostok file and return the parsed payload.
 * Throws on wrong passphrase (GCM tag mismatch) or corrupt file.
 */
export async function importBackupFile(
  fileBytes: Uint8Array,
  passphrase: string,
): Promise<BackupPayload> {
  const { salt, body } = parseHeader(fileBytes)
  const key = await deriveBackupKey(passphrase, salt)

  let json: string
  try {
    json = await decrypt(body, key)
  } catch {
    throw new Error('Wrong backup password')
  }

  const payload = JSON.parse(json) as BackupPayload
  if (payload.version !== 1) {
    throw new Error(`Unsupported backup payload version: ${payload.version}`)
  }
  return payload
}
