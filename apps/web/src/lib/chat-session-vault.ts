import type { ChatDeviceSession, ChatMessage } from './api'
import { base64ToBytes, bytesToBase64 } from './base64'

const SESSION_ALGORITHM = 'vostok-chat-session-v1'
const SESSION_KEY_PREFIX = 'vostok.session-key.'
const SESSION_HANDSHAKE_PREFIX = 'vostok.session-handshake.'
const SESSION_RATCHET_PREFIX = 'vostok.session-ratchet.'
const SESSION_SKIPPED_KEY_PREFIX = 'vostok.session-skipped.'
const SESSION_EPHEMERAL_KEY_PREFIX = 'vostok.session-ephemeral.'
const PENDING_SESSION_EPHEMERAL_KEY_PREFIX = 'vostok.session-ephemeral-pending.'
const CONTENT_IV_BYTES = 12
const MAX_SKIPPED_MESSAGE_KEYS = 64

type SessionHeader = {
  algorithm: string
  content_iv: string
  session_map: Record<string, string>
  handshake_map: Record<string, string> | null
  counter_map: Record<string, number> | null
}

export type LocalSessionDeviceMaterial = {
  deviceId: string
  encryptionPrivateKeyPkcs8Base64?: string
  signedPrekeyPublicKeyBase64?: string
  signedPrekeyPrivateKeyPkcs8Base64?: string
  signedPrekeys?: Array<{
    publicKeyBase64: string
    privateKeyPkcs8Base64: string
  }>
  oneTimePrekeys?: Array<{
    publicKeyBase64: string
    privateKeyPkcs8Base64: string
  }>
}

type EncryptedEnvelope = {
  ciphertext: string
  header: string
  recipient_envelopes: Record<string, string>
}

type StoredSessionEphemeralKey = {
  publicKeyBase64: string
  privateKeyPkcs8Base64: string
}

type SessionRatchetState = {
  send: number
  receive: number
  sendChainKeyBase64: string
  receiveChainKeyBase64: string
}

export async function prepareSessionBootstrap(
  recipientDeviceIds: string[]
): Promise<Record<string, string>> {
  ensureWebCrypto()

  const uniqueRecipientDeviceIds = [...new Set(recipientDeviceIds.filter(Boolean))]

  const entries = await Promise.all(
    uniqueRecipientDeviceIds.map(async (deviceId) => {
      const ephemeralKeyPair = await generateEphemeralKeyPair()
      window.localStorage.setItem(
        `${PENDING_SESSION_EPHEMERAL_KEY_PREFIX}${ephemeralKeyPair.publicKeyBase64}`,
        ephemeralKeyPair.privateKeyPkcs8Base64
      )

      return [deviceId, ephemeralKeyPair.publicKeyBase64] as const
    })
  )

  return Object.fromEntries(entries)
}

export async function synchronizeChatSessions(
  currentDevice: LocalSessionDeviceMaterial,
  sessions: ChatDeviceSession[]
): Promise<string[]> {
  ensureWebCrypto()

  const synchronized: string[] = []

  for (const session of sessions) {
    if (!(await verifyChatDeviceSession(session))) {
      continue
    }

    const expectedHandshakeHash = await computeSessionHandshakeHash(session)

    if (session.handshake_hash !== expectedHandshakeHash) {
      continue
    }

    rememberInitiatorEphemeralKey(currentDevice.deviceId, session)

    const keyBytes = await deriveSessionKeyBytes(currentDevice, session)

    if (!keyBytes) {
      continue
    }

    const previousHandshakeHash = readStoredSessionHandshakeHash(session.id)

    window.localStorage.setItem(`${SESSION_KEY_PREFIX}${session.id}`, bytesToBase64(keyBytes))
    window.localStorage.setItem(`${SESSION_HANDSHAKE_PREFIX}${session.id}`, session.handshake_hash)

    if (previousHandshakeHash !== session.handshake_hash) {
      const ratchetState = await buildInitialRatchetState(
        keyBytes,
        session.id,
        session.handshake_hash
      )

      writeStoredSessionRatchetState(session.id, ratchetState)
      writeStoredSkippedMessageKeys(session.id, {})
    }

    synchronized.push(session.id)
  }

  return synchronized
}

export async function encryptMessageWithSessions(
  plaintext: string,
  currentDeviceId: string,
  sessions: ChatDeviceSession[]
): Promise<EncryptedEnvelope> {
  ensureWebCrypto()

  const sessionMap = buildSendSessionMap(currentDeviceId, sessions)
  const handshakeMap = buildSendHandshakeMap(currentDeviceId, sessions)
  const selfSessionId = sessionMap[currentDeviceId]
  const selfHandshakeHash = handshakeMap[currentDeviceId]

  if (!selfSessionId || !selfHandshakeHash) {
    throw new Error('A self-session is required before sending a session-encrypted message.')
  }

  const iv = window.crypto.getRandomValues(new Uint8Array(CONTENT_IV_BYTES))
  const encoded = new TextEncoder().encode(plaintext)
  const encryptedPairs: Array<readonly [string, string]> = []
  const counterMap: Record<string, number> = {}
  const nextRatchetStates: Array<readonly [string, SessionRatchetState]> = []

  for (const [deviceId, sessionId] of Object.entries(sessionMap)) {
    const handshakeHash = handshakeMap[deviceId]

    if (!handshakeHash) {
      throw new Error('A direct-chat session handshake is missing locally.')
    }

    const rootKeyBytes = readStoredSessionKeyBytes(sessionId)

    if (!rootKeyBytes) {
      throw new Error('A direct-chat session key is missing locally.')
    }

    const ratchetState = await readOrBuildSessionRatchetState(sessionId, rootKeyBytes, handshakeHash)
    const counter = ratchetState.send
    const ratchetStep = await deriveRatchetStep(
      base64ToBytes(ratchetState.sendChainKeyBase64),
      sessionId,
      handshakeHash,
      counter
    )
    const key = await importAesKey(ratchetStep.messageKeyBytes, ['encrypt'])
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      encoded
    )

    encryptedPairs.push([deviceId, bytesToBase64(ciphertext)] as const)
    counterMap[deviceId] = counter
    nextRatchetStates.push([
      sessionId,
      {
        ...ratchetState,
        send: counter + 1,
        sendChainKeyBase64: bytesToBase64(ratchetStep.nextChainKeyBytes)
      }
    ] as const)
  }

  for (const [sessionId, nextRatchetState] of nextRatchetStates) {
    writeStoredSessionRatchetState(sessionId, nextRatchetState)
  }

  const recipientEnvelopes = Object.fromEntries(encryptedPairs)

  return {
    ciphertext: recipientEnvelopes[currentDeviceId] ?? encryptedPairs[0]?.[1] ?? '',
    header: encodeSessionHeader({
      algorithm: SESSION_ALGORITHM,
      content_iv: bytesToBase64(iv),
      session_map: sessionMap,
      handshake_map: handshakeMap,
      counter_map: counterMap
    }),
    recipient_envelopes: recipientEnvelopes
  }
}

export async function decryptMessageWithSessions(
  message: ChatMessage,
  currentDeviceId: string
): Promise<string> {
  const header = parseSessionHeader(message.header)

  if (!header) {
    throw new Error('Message header is not a session header.')
  }

  const sessionId = header.session_map[currentDeviceId]

  if (!sessionId) {
    throw new Error('No direct-chat session is available for this device.')
  }

  const rootKeyBytes = readStoredSessionKeyBytes(sessionId)

  if (!rootKeyBytes) {
    throw new Error('The direct-chat session key is not cached locally.')
  }

  const cachedHandshakeHash = readStoredSessionHandshakeHash(sessionId)
  const expectedHandshakeHash = header.handshake_map?.[currentDeviceId] ?? cachedHandshakeHash

  if (!cachedHandshakeHash || !expectedHandshakeHash || cachedHandshakeHash !== expectedHandshakeHash) {
    throw new Error('The cached direct-chat session handshake does not match this message.')
  }

  if (!message.recipient_envelope) {
    throw new Error('The device-specific ciphertext is missing.')
  }

  const counter = header.counter_map?.[currentDeviceId]
  const key =
    typeof counter === 'number'
      ? await resolveInboundMessageKey(sessionId, rootKeyBytes, cachedHandshakeHash, counter)
      : await importAesKey(rootKeyBytes, ['decrypt'])

  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(header.content_iv)) },
    key,
    toArrayBuffer(base64ToBytes(message.recipient_envelope))
  )

  return new TextDecoder().decode(plaintext)
}

export function isSessionHeader(headerBase64: string | null): boolean {
  return parseSessionHeader(headerBase64)?.algorithm === SESSION_ALGORITHM
}

function buildSendSessionMap(
  currentDeviceId: string,
  sessions: ChatDeviceSession[]
): Record<string, string> {
  const mapped = sessions
    .filter((session) => session.initiator_device_id === currentDeviceId)
    .map((session) => [session.recipient_device_id, session.id] as const)

  return Object.fromEntries(mapped)
}

function buildSendHandshakeMap(
  currentDeviceId: string,
  sessions: ChatDeviceSession[]
): Record<string, string> {
  const mapped = sessions
    .filter((session) => session.initiator_device_id === currentDeviceId)
    .map((session) => [session.recipient_device_id, session.handshake_hash] as const)

  return Object.fromEntries(mapped)
}

async function verifyChatDeviceSession(session: ChatDeviceSession): Promise<boolean> {
  const initiatorValid = await verifyEd25519Signature(
    session.initiator_identity_public_key,
    session.initiator_signed_prekey,
    session.initiator_signed_prekey_signature
  )
  const recipientValid = await verifyEd25519Signature(
    session.recipient_identity_public_key,
    session.recipient_signed_prekey,
    session.recipient_signed_prekey_signature
  )

  return initiatorValid && recipientValid
}

async function computeSessionHandshakeHash(session: ChatDeviceSession): Promise<string> {
  const encoded = new TextEncoder().encode(
    JSON.stringify([
      ['chat_id', session.chat_id],
      ['session_id', session.id],
      ['initiator_device_id', session.initiator_device_id],
      ['recipient_device_id', session.recipient_device_id],
      ['initiator_identity_public_key', session.initiator_identity_public_key],
      ['initiator_encryption_public_key', session.initiator_encryption_public_key],
      ['initiator_ephemeral_public_key', session.initiator_ephemeral_public_key],
      ['initiator_signed_prekey', session.initiator_signed_prekey],
      ['initiator_signed_prekey_signature', session.initiator_signed_prekey_signature],
      ['recipient_identity_public_key', session.recipient_identity_public_key],
      ['recipient_encryption_public_key', session.recipient_encryption_public_key],
      ['recipient_signed_prekey', session.recipient_signed_prekey],
      ['recipient_signed_prekey_signature', session.recipient_signed_prekey_signature],
      ['recipient_one_time_prekey', session.recipient_one_time_prekey]
    ])
  )
  const digest = await window.crypto.subtle.digest('SHA-256', encoded)
  return bytesToBase64(digest)
}

async function deriveSessionKeyBytes(
  currentDevice: LocalSessionDeviceMaterial,
  session: ChatDeviceSession
): Promise<Uint8Array | null> {
  if (!currentDevice.encryptionPrivateKeyPkcs8Base64) {
    return null
  }

  if (!session.initiator_ephemeral_public_key) {
    return null
  }

  const encryptionPrivateKey = await importPrivateKey(currentDevice.encryptionPrivateKeyPkcs8Base64)
  const transcriptParts = [base64ToBytes(session.initiator_ephemeral_public_key)]

  let materialParts: Uint8Array[]

  if (currentDevice.deviceId === session.initiator_device_id) {
    const initiatorEphemeralPrivateKey = await resolveInitiatorEphemeralPrivateKey(session)

    if (!initiatorEphemeralPrivateKey) {
      return null
    }

    const recipientSignedPrekey = await importPublicKey(session.recipient_signed_prekey)
    const recipientEncryptionPublicKey = await importPublicKey(session.recipient_encryption_public_key)
    const staticSecret = await deriveSharedSecret(encryptionPrivateKey, recipientSignedPrekey)
    const ephemeralToStaticSecret = await deriveSharedSecret(
      initiatorEphemeralPrivateKey,
      recipientEncryptionPublicKey
    )
    const ephemeralToSignedPrekeySecret = await deriveSharedSecret(
      initiatorEphemeralPrivateKey,
      recipientSignedPrekey
    )
    const oneTimeSecret = session.recipient_one_time_prekey
      ? await deriveSharedSecret(
          initiatorEphemeralPrivateKey,
          await importPublicKey(session.recipient_one_time_prekey)
        )
      : null

    materialParts = [staticSecret, ephemeralToStaticSecret, ephemeralToSignedPrekeySecret]

    if (oneTimeSecret) {
      materialParts.push(oneTimeSecret)
    }
  } else if (currentDevice.deviceId === session.recipient_device_id) {
    const signedPrekeyPrivateKey = await resolveSignedPrekeyPrivateKey(currentDevice, session)

    if (!signedPrekeyPrivateKey) {
      return null
    }

    const initiatorEncryptionPublicKey = await importPublicKey(session.initiator_encryption_public_key)
    const initiatorEphemeralPublicKey = await importPublicKey(session.initiator_ephemeral_public_key)
    const staticSecret = await deriveSharedSecret(signedPrekeyPrivateKey, initiatorEncryptionPublicKey)
    const ephemeralToStaticSecret = await deriveSharedSecret(
      encryptionPrivateKey,
      initiatorEphemeralPublicKey
    )
    const ephemeralToSignedPrekeySecret = await deriveSharedSecret(
      signedPrekeyPrivateKey,
      initiatorEphemeralPublicKey
    )
    const oneTimeSecret = session.recipient_one_time_prekey
      ? await deriveRecipientOneTimeSecret(
          currentDevice,
          session.recipient_one_time_prekey,
          initiatorEphemeralPublicKey
        )
      : null

    materialParts = [staticSecret, ephemeralToStaticSecret, ephemeralToSignedPrekeySecret]

    if (oneTimeSecret) {
      materialParts.push(oneTimeSecret)
    }
  } else {
    return null
  }

  materialParts.push(...transcriptParts, new TextEncoder().encode(session.id))

  const digest = await window.crypto.subtle.digest('SHA-256', toArrayBuffer(concatBytes(...materialParts)))
  return new Uint8Array(digest)
}

function rememberInitiatorEphemeralKey(currentDeviceId: string, session: ChatDeviceSession) {
  if (currentDeviceId !== session.initiator_device_id || !session.initiator_ephemeral_public_key) {
    return
  }

  const existing = readStoredSessionEphemeralKey(session.id)

  if (existing?.publicKeyBase64 === session.initiator_ephemeral_public_key) {
    return
  }

  const pendingPrivateKeyPkcs8Base64 = claimPendingSessionEphemeralKey(session.initiator_ephemeral_public_key)

  if (!pendingPrivateKeyPkcs8Base64) {
    return
  }

  writeStoredSessionEphemeralKey(session.id, {
    publicKeyBase64: session.initiator_ephemeral_public_key,
    privateKeyPkcs8Base64: pendingPrivateKeyPkcs8Base64
  })
}

async function resolveInitiatorEphemeralPrivateKey(
  session: ChatDeviceSession
): Promise<CryptoKey | null> {
  if (!session.initiator_ephemeral_public_key) {
    return null
  }

  const ephemeralKeyPair = readStoredSessionEphemeralKey(session.id)

  if (!ephemeralKeyPair || ephemeralKeyPair.publicKeyBase64 !== session.initiator_ephemeral_public_key) {
    return null
  }

  return importPrivateKey(ephemeralKeyPair.privateKeyPkcs8Base64)
}

async function resolveSignedPrekeyPrivateKey(
  currentDevice: LocalSessionDeviceMaterial,
  session: ChatDeviceSession
): Promise<CryptoKey | null> {
  const expectedPublicKey =
    currentDevice.deviceId === session.initiator_device_id
      ? session.initiator_signed_prekey
      : currentDevice.deviceId === session.recipient_device_id
        ? session.recipient_signed_prekey
        : null

  if (!expectedPublicKey) {
    return null
  }

  const knownPrekey =
    currentDevice.signedPrekeys?.find((prekey) => prekey.publicKeyBase64 === expectedPublicKey) ??
    (currentDevice.signedPrekeyPrivateKeyPkcs8Base64 &&
    currentDevice.signedPrekeyPublicKeyBase64 === expectedPublicKey
      ? {
          publicKeyBase64: expectedPublicKey,
          privateKeyPkcs8Base64: currentDevice.signedPrekeyPrivateKeyPkcs8Base64
        }
      : null)

  if (!knownPrekey) {
    return null
  }

  return importPrivateKey(knownPrekey.privateKeyPkcs8Base64)
}

async function deriveRecipientOneTimeSecret(
  currentDevice: LocalSessionDeviceMaterial,
  oneTimePrekeyPublicKeyBase64: string,
  initiatorEncryptionPublicKey: CryptoKey
): Promise<Uint8Array | null> {
  const match = currentDevice.oneTimePrekeys?.find(
    (prekey) => prekey.publicKeyBase64 === oneTimePrekeyPublicKeyBase64
  )

  if (!match) {
    return null
  }

  return deriveSharedSecret(
    await importPrivateKey(match.privateKeyPkcs8Base64),
    initiatorEncryptionPublicKey
  )
}

async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<Uint8Array> {
  const sharedSecret = await window.crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: publicKey
    },
    privateKey,
    256
  )

  return new Uint8Array(sharedSecret)
}

function readStoredSessionHandshakeHash(sessionId: string): string | null {
  return window.localStorage.getItem(`${SESSION_HANDSHAKE_PREFIX}${sessionId}`)
}

function readStoredSessionKeyBytes(sessionId: string): Uint8Array | null {
  const serialized = window.localStorage.getItem(`${SESSION_KEY_PREFIX}${sessionId}`)

  if (!serialized) {
    return null
  }

  return base64ToBytes(serialized)
}

async function readOrBuildSessionRatchetState(
  sessionId: string,
  rootKeyBytes: Uint8Array,
  handshakeHash: string
): Promise<SessionRatchetState> {
  const existing = readStoredSessionRatchetState(sessionId)

  if (existing) {
    return existing
  }

  const initial = await buildInitialRatchetState(rootKeyBytes, sessionId, handshakeHash)
  writeStoredSessionRatchetState(sessionId, initial)
  return initial
}

function readStoredSessionEphemeralKey(sessionId: string): StoredSessionEphemeralKey | null {
  const serialized = window.localStorage.getItem(`${SESSION_EPHEMERAL_KEY_PREFIX}${sessionId}`)

  if (!serialized) {
    return null
  }

  try {
    const parsed = JSON.parse(serialized) as Partial<StoredSessionEphemeralKey>

    if (
      typeof parsed.publicKeyBase64 !== 'string' ||
      typeof parsed.privateKeyPkcs8Base64 !== 'string'
    ) {
      return null
    }

    return {
      publicKeyBase64: parsed.publicKeyBase64,
      privateKeyPkcs8Base64: parsed.privateKeyPkcs8Base64
    }
  } catch {
    return null
  }
}

function writeStoredSessionEphemeralKey(sessionId: string, keyPair: StoredSessionEphemeralKey) {
  window.localStorage.setItem(`${SESSION_EPHEMERAL_KEY_PREFIX}${sessionId}`, JSON.stringify(keyPair))
}

function claimPendingSessionEphemeralKey(publicKeyBase64: string): string | null {
  const storageKey = `${PENDING_SESSION_EPHEMERAL_KEY_PREFIX}${publicKeyBase64}`
  const privateKeyPkcs8Base64 = window.localStorage.getItem(storageKey)

  if (!privateKeyPkcs8Base64) {
    return null
  }

  window.localStorage.removeItem(storageKey)
  return privateKeyPkcs8Base64
}

function readStoredSessionRatchetState(sessionId: string): SessionRatchetState | null {
  const serialized = window.localStorage.getItem(`${SESSION_RATCHET_PREFIX}${sessionId}`)

  if (!serialized) {
    return null
  }

  try {
    const parsed = JSON.parse(serialized) as Partial<SessionRatchetState>
    const send = normalizeCounter(parsed.send)
    const receive = normalizeCounter(parsed.receive)
    const sendChainKeyBase64 = normalizeNonEmptyString(parsed.sendChainKeyBase64)
    const receiveChainKeyBase64 = normalizeNonEmptyString(parsed.receiveChainKeyBase64)

    if (!sendChainKeyBase64 || !receiveChainKeyBase64) {
      return null
    }

    return {
      send,
      receive,
      sendChainKeyBase64,
      receiveChainKeyBase64
    }
  } catch {
    return null
  }
}

function writeStoredSessionRatchetState(sessionId: string, ratchetState: SessionRatchetState) {
  window.localStorage.setItem(`${SESSION_RATCHET_PREFIX}${sessionId}`, JSON.stringify(ratchetState))
}

function readStoredSkippedMessageKeys(sessionId: string): Record<string, string> {
  const serialized = window.localStorage.getItem(`${SESSION_SKIPPED_KEY_PREFIX}${sessionId}`)

  if (!serialized) {
    return {}
  }

  try {
    const parsed = JSON.parse(serialized) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string'
      )
    )
  } catch {
    return {}
  }
}

function writeStoredSkippedMessageKeys(sessionId: string, skippedKeys: Record<string, string>) {
  window.localStorage.setItem(`${SESSION_SKIPPED_KEY_PREFIX}${sessionId}`, JSON.stringify(skippedKeys))
}

async function importPrivateKey(privateKeyPkcs8Base64: string): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(base64ToBytes(privateKeyPkcs8Base64)),
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false,
    ['deriveBits']
  )
}

async function buildInitialRatchetState(
  rootKeyBytes: Uint8Array,
  sessionId: string,
  handshakeHash: string
): Promise<SessionRatchetState> {
  const initialChainKeyBytes = await digestBytes(
    rootKeyBytes,
    base64ToBytes(handshakeHash),
    new TextEncoder().encode(sessionId),
    new TextEncoder().encode('vostok:chain:root')
  )

  const chainKeyBase64 = bytesToBase64(initialChainKeyBytes)

  return {
    send: 0,
    receive: 0,
    sendChainKeyBase64: chainKeyBase64,
    receiveChainKeyBase64: chainKeyBase64
  }
}

async function deriveRatchetStep(
  chainKeyBytes: Uint8Array,
  sessionId: string,
  handshakeHash: string,
  counter: number
): Promise<{ messageKeyBytes: Uint8Array; nextChainKeyBytes: Uint8Array }> {
  const handshakeHashBytes = base64ToBytes(handshakeHash)
  const sessionIdBytes = new TextEncoder().encode(sessionId)
  const counterBytes = encodeCounter(counter)
  const messageKeyBytes = await digestBytes(
    chainKeyBytes,
    handshakeHashBytes,
    sessionIdBytes,
    counterBytes,
    new TextEncoder().encode('vostok:chain:message')
  )
  const nextChainKeyBytes = await digestBytes(
    chainKeyBytes,
    handshakeHashBytes,
    sessionIdBytes,
    new TextEncoder().encode('vostok:chain:next')
  )

  return {
    messageKeyBytes,
    nextChainKeyBytes
  }
}

async function resolveInboundMessageKey(
  sessionId: string,
  rootKeyBytes: Uint8Array,
  handshakeHash: string,
  counter: number
): Promise<CryptoKey> {
  const skippedKeyLabel = String(counter)
  const skippedKeys = readStoredSkippedMessageKeys(sessionId)
  const skippedMessageKeyBase64 = skippedKeys[skippedKeyLabel]

  if (skippedMessageKeyBase64) {
    delete skippedKeys[skippedKeyLabel]
    writeStoredSkippedMessageKeys(sessionId, skippedKeys)
    return importAesKey(base64ToBytes(skippedMessageKeyBase64), ['decrypt'])
  }

  let ratchetState = await readOrBuildSessionRatchetState(sessionId, rootKeyBytes, handshakeHash)

  if (counter < ratchetState.receive) {
    throw new Error('The skipped message key is no longer available for this session.')
  }

  if (counter - ratchetState.receive > MAX_SKIPPED_MESSAGE_KEYS) {
    throw new Error('Too many skipped messages for this direct-chat session.')
  }

  const updatedSkippedKeys = { ...skippedKeys }

  while (ratchetState.receive < counter) {
    const skippedStep = await deriveRatchetStep(
      base64ToBytes(ratchetState.receiveChainKeyBase64),
      sessionId,
      handshakeHash,
      ratchetState.receive
    )
    updatedSkippedKeys[String(ratchetState.receive)] = bytesToBase64(skippedStep.messageKeyBytes)
    ratchetState = {
      ...ratchetState,
      receive: ratchetState.receive + 1,
      receiveChainKeyBase64: bytesToBase64(skippedStep.nextChainKeyBytes)
    }
  }

  const messageStep = await deriveRatchetStep(
    base64ToBytes(ratchetState.receiveChainKeyBase64),
    sessionId,
    handshakeHash,
    ratchetState.receive
  )
  const nextRatchetState: SessionRatchetState = {
    ...ratchetState,
    receive: ratchetState.receive + 1,
    receiveChainKeyBase64: bytesToBase64(messageStep.nextChainKeyBytes)
  }

  pruneSkippedMessageKeys(updatedSkippedKeys)
  writeStoredSkippedMessageKeys(sessionId, updatedSkippedKeys)
  writeStoredSessionRatchetState(sessionId, nextRatchetState)

  return importAesKey(messageStep.messageKeyBytes, ['decrypt'])
}

function pruneSkippedMessageKeys(skippedKeys: Record<string, string>) {
  const entries = Object.entries(skippedKeys)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort((left, right) => Number(left[0]) - Number(right[0]))

  if (entries.length <= MAX_SKIPPED_MESSAGE_KEYS) {
    return
  }

  const removable = entries.slice(0, entries.length - MAX_SKIPPED_MESSAGE_KEYS)

  for (const [counter] of removable) {
    delete skippedKeys[counter]
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

async function digestBytes(...parts: Uint8Array[]): Promise<Uint8Array> {
  const digest = await window.crypto.subtle.digest('SHA-256', toArrayBuffer(concatBytes(...parts)))
  return new Uint8Array(digest)
}

async function generateEphemeralKeyPair(): Promise<StoredSessionEphemeralKey> {
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

async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    'raw',
    toArrayBuffer(base64ToBytes(publicKeyBase64)),
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false,
    []
  )
}

async function verifyEd25519Signature(
  identityPublicKeyBase64: string,
  payloadBase64: string,
  signatureBase64: string
): Promise<boolean> {
  try {
    const publicKey = await window.crypto.subtle.importKey(
      'raw',
      toArrayBuffer(base64ToBytes(identityPublicKeyBase64)),
      { name: 'Ed25519' },
      false,
      ['verify']
    )

    return window.crypto.subtle.verify(
      'Ed25519',
      publicKey,
      toArrayBuffer(base64ToBytes(signatureBase64)),
      toArrayBuffer(base64ToBytes(payloadBase64))
    )
  } catch {
    return false
  }
}

function parseSessionHeader(headerBase64: string | null): SessionHeader | null {
  if (!headerBase64) {
    return null
  }

  try {
    const raw = new TextDecoder().decode(base64ToBytes(headerBase64))
    const parsed = JSON.parse(raw) as Partial<SessionHeader>

    if (
      parsed.algorithm !== SESSION_ALGORITHM ||
      typeof parsed.content_iv !== 'string' ||
      !parsed.session_map ||
      typeof parsed.session_map !== 'object'
    ) {
      return null
    }

    const sessionMap = Object.fromEntries(
      Object.entries(parsed.session_map).filter(
        (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string'
      )
    )
    const handshakeMap =
      parsed.handshake_map && typeof parsed.handshake_map === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.handshake_map).filter(
              (entry): entry is [string, string] =>
                typeof entry[0] === 'string' && typeof entry[1] === 'string'
            )
          )
        : null
    const counterMap =
      parsed.counter_map && typeof parsed.counter_map === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.counter_map).filter(
              (entry): entry is [string, number] =>
                typeof entry[0] === 'string' && Number.isInteger(entry[1]) && entry[1] >= 0
            )
          )
        : null

    return {
      algorithm: parsed.algorithm,
      content_iv: parsed.content_iv,
      session_map: sessionMap,
      handshake_map: handshakeMap,
      counter_map: counterMap
    }
  } catch {
    return null
  }
}

function encodeSessionHeader(header: SessionHeader): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(header)))
}

function normalizeCounter(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function encodeCounter(counter: number): Uint8Array {
  const normalized = normalizeCounter(counter)
  const view = new DataView(new ArrayBuffer(4))
  view.setUint32(0, normalized)
  return new Uint8Array(view.buffer)
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((size, part) => size + part.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0

  for (const part of parts) {
    merged.set(part, offset)
    offset += part.byteLength
  }

  return merged
}

function ensureWebCrypto() {
  if (!window.crypto?.subtle) {
    throw new Error('WebCrypto is not available in this browser.')
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
