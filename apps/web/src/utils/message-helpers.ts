import type { ChatMessage } from '../lib/api.ts'
import type { CachedMessage } from '../lib/message-cache.ts'
import type { AttachmentDescriptor } from '../types.ts'
import { decryptMessageText } from '../lib/message-vault.ts'
import { base64ToBytes } from '../lib/base64.ts'
import { compareMessageOrder } from './chat-helpers.ts'

// Local plaintext cache for outgoing messages so the sender can read their own
// messages even when the E2E envelope is not decryptable on the same device.
// Persisted to localStorage so the cache survives page reloads.
const SENT_PLAINTEXT_STORAGE_KEY = 'vostok.sent-plaintext'
const sentPlaintextByClientId = new Map<string, { text: string; attachment?: CachedMessage['attachment'] }>()

// Rehydrate from localStorage on module load.
try {
  const raw = window.localStorage.getItem(SENT_PLAINTEXT_STORAGE_KEY)
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, { text: string; attachment?: CachedMessage['attachment'] }>
    for (const [key, value] of Object.entries(parsed)) {
      if (value && typeof value.text === 'string') {
        sentPlaintextByClientId.set(key, value)
      }
    }
  }
} catch {
  // Ignore storage errors on load.
}

// Cache of successfully decrypted message plaintext, keyed by server message ID.
// The Double Ratchet is stateful — each message key can only be derived once
// (the chain counter advances after decryption).  When syncMessagesFromServerNow
// re-fetches all messages from the server, previously-decrypted messages must
// use the cached plaintext instead of re-decrypting through the ratchet.
const decryptedPlaintextByMessageId = new Map<string, { text: string; attachment?: CachedMessage['attachment'] }>()

function cacheDecryptedPlaintext(messageId: string, text: string, attachment?: CachedMessage['attachment']) {
  decryptedPlaintextByMessageId.set(messageId, { text, attachment })
}

/**
 * Seed the in-memory decrypted-plaintext cache from persisted cached messages.
 * Call this after reading the IndexedDB/localStorage message cache on page load
 * so that subsequent `projectMessage` calls find previously-decrypted text
 * without re-running the Double Ratchet (which would fail because the chain
 * counter already advanced in the previous session).
 */
export function seedDecryptedCacheFromPersisted(messages: CachedMessage[]) {
  const encryptedPlaceholder = '[Encrypted envelope available but not decryptable on this device]'
  for (const msg of messages) {
    // Skip system messages, optimistic placeholders, and the error placeholder.
    if (msg.side === 'system' || msg.id.startsWith('optimistic-') || !msg.text) {
      continue
    }
    if (msg.text === encryptedPlaceholder) {
      continue
    }
    if (!decryptedPlaintextByMessageId.has(msg.id)) {
      decryptedPlaintextByMessageId.set(msg.id, { text: msg.text, attachment: msg.attachment })
    }
  }
}

function lookupDecryptedPlaintext(messageId: string | undefined) {
  return messageId ? decryptedPlaintextByMessageId.get(messageId) ?? null : null
}

export function cacheSentPlaintext(clientId: string, text: string, attachment?: CachedMessage['attachment']) {
  sentPlaintextByClientId.set(clientId, { text, attachment })

  // Persist to localStorage so the cache survives page reloads.
  // Cap at 200 entries to avoid unbounded growth.
  try {
    if (sentPlaintextByClientId.size > 200) {
      const keysToRemove = Array.from(sentPlaintextByClientId.keys()).slice(0, sentPlaintextByClientId.size - 200)
      for (const key of keysToRemove) {
        sentPlaintextByClientId.delete(key)
      }
    }
    const obj: Record<string, { text: string; attachment?: CachedMessage['attachment'] }> = {}
    for (const [k, v] of sentPlaintextByClientId) {
      obj[k] = v
    }
    window.localStorage.setItem(SENT_PLAINTEXT_STORAGE_KEY, JSON.stringify(obj))
  } catch {
    // Storage full or unavailable — no-op.
  }
}

function lookupSentPlaintext(clientId: string | undefined) {
  return clientId ? sentPlaintextByClientId.get(clientId) ?? null : null
}

export function parseDecryptedPayload(plaintext: string): {
  text: string
  attachment?: CachedMessage['attachment']
} {
  try {
    const parsed = JSON.parse(plaintext) as Partial<AttachmentDescriptor>

    if (
      parsed.kind === 'attachment' &&
      typeof parsed.uploadId === 'string' &&
      typeof parsed.fileName === 'string' &&
      typeof parsed.contentType === 'string' &&
      typeof parsed.size === 'number' &&
      Number.isFinite(parsed.size) &&
      (typeof parsed.thumbnailDataUrl === 'undefined' || typeof parsed.thumbnailDataUrl === 'string') &&
      (typeof parsed.waveform === 'undefined' ||
        (Array.isArray(parsed.waveform) && parsed.waveform.every((value) => typeof value === 'number'))) &&
      typeof parsed.contentKeyBase64 === 'string' &&
      typeof parsed.ivBase64 === 'string'
    ) {
      return {
        text:
          parsed.contentType.startsWith('audio/') && parsed.fileName.startsWith('voice-note-')
            ? `Voice note: ${parsed.fileName}`
            : parsed.contentType.startsWith('video/') && parsed.fileName.startsWith('round-video-')
              ? `Round video: ${parsed.fileName}`
            : `Attachment: ${parsed.fileName}`,
        attachment: {
          uploadId: parsed.uploadId,
          fileName: parsed.fileName,
          contentType: parsed.contentType,
          size: parsed.size,
          thumbnailDataUrl: parsed.thumbnailDataUrl,
          waveform: parsed.waveform as number[] | undefined,
          contentKeyBase64: parsed.contentKeyBase64,
          ivBase64: parsed.ivBase64
        }
      }
    }
  } catch {
    // Plain text payloads are expected.
  }

  return {
    text: plaintext
  }
}

export function mergeMessageThread(current: CachedMessage[], next: CachedMessage): CachedMessage[] {
  let preservedSentAt: string | undefined

  const filtered = current.filter((message) => {
    if (message.id === next.id) {
      return false
    }

    if (next.clientId && message.clientId === next.clientId) {
      // When replacing an optimistic message with its server-confirmed version,
      // preserve the original sentAt so the message doesn't visually jump to a
      // different position in the thread due to client/server clock skew.
      preservedSentAt = message.sentAt
      return false
    }

    return true
  })

  const merged = preservedSentAt ? { ...next, sentAt: preservedSentAt } : next
  return [...filtered, merged].sort(compareMessageOrder)
}

export function decodeSystemMessageText(payloadBase64: string): string {
  try {
    return new TextDecoder().decode(base64ToBytes(payloadBase64))
  } catch {
    return '[System event unavailable]'
  }
}

export async function projectMessage(
  message: ChatMessage,
  currentDeviceId: string,
  encryptionPrivateKeyPkcs8Base64?: string
): Promise<CachedMessage> {
  if (message.message_kind === 'system') {
    return {
      id: message.id,
      clientId: message.client_id,
      text: decodeSystemMessageText(message.ciphertext),
      sentAt: message.inserted_at,
      pinnedAt: message.pinned_at ?? undefined,
      side: 'system',
      decryptable: true,
      reactions: message.reactions.map((reaction) => ({
        reactionKey: reaction.reaction_key,
        count: reaction.count,
        reacted: reaction.reacted
      }))
    }
  }

  if (message.deleted_at) {
    return {
      id: message.id,
      clientId: message.client_id,
      replyToMessageId: message.reply_to_message_id ?? undefined,
      text: 'Message deleted',
      sentAt: message.inserted_at,
      pinnedAt: message.pinned_at ?? undefined,
      editedAt: message.edited_at ?? undefined,
      deletedAt: message.deleted_at,
      side: message.sender_device_id === currentDeviceId ? 'outgoing' : 'incoming',
      senderId: message.sender_device_id,
      senderUsername: message.sender_username ?? undefined,
      decryptable: true,
      reactions: message.reactions.map((reaction) => ({
        reactionKey: reaction.reaction_key,
        count: reaction.count,
        reacted: reaction.reacted
      }))
    }
  }

  // Check the decrypted-plaintext cache first.  The Double Ratchet is stateful
  // — each message key can only be derived once (the chain counter advances).
  // When syncMessagesFromServerNow re-fetches all messages, previously-decrypted
  // messages must use the cache rather than re-running the ratchet.
  const previouslyDecrypted = lookupDecryptedPlaintext(message.id)

  if (previouslyDecrypted) {
    return {
      id: message.id,
      clientId: message.client_id,
      replyToMessageId: message.reply_to_message_id ?? undefined,
      text: previouslyDecrypted.text,
      sentAt: message.inserted_at,
      pinnedAt: message.pinned_at ?? undefined,
      editedAt: message.edited_at ?? undefined,
      deletedAt: message.deleted_at ?? undefined,
      side: message.sender_device_id === currentDeviceId ? 'outgoing' : 'incoming',
      senderId: message.sender_device_id,
      senderUsername: message.sender_username ?? undefined,
      decryptable: true,
      attachment: previouslyDecrypted.attachment,
      reactions: message.reactions.map((reaction) => ({
        reactionKey: reaction.reaction_key,
        count: reaction.count,
        reacted: reaction.reacted
      }))
    }
  }

  try {
    const decryptedText = await decryptMessageText(
      message,
      currentDeviceId,
      encryptionPrivateKeyPkcs8Base64
    )
    const parsedPayload = parseDecryptedPayload(decryptedText)

    // Cache the successful decryption so subsequent syncs don't re-run the
    // ratchet (which would fail because the chain counter already advanced).
    cacheDecryptedPlaintext(message.id, parsedPayload.text, parsedPayload.attachment)

    return {
      id: message.id,
      clientId: message.client_id,
      replyToMessageId: message.reply_to_message_id ?? undefined,
      text: parsedPayload.text,
      sentAt: message.inserted_at,
      pinnedAt: message.pinned_at ?? undefined,
      editedAt: message.edited_at ?? undefined,
      deletedAt: message.deleted_at ?? undefined,
      side: message.sender_device_id === currentDeviceId ? 'outgoing' : 'incoming',
      senderId: message.sender_device_id,
      senderUsername: message.sender_username ?? undefined,
      decryptable: true,
      attachment: parsedPayload.attachment,
      reactions: message.reactions.map((reaction) => ({
        reactionKey: reaction.reaction_key,
        count: reaction.count,
        reacted: reaction.reacted
      }))
    }
  } catch (decryptionError) {
    console.error(
      `[projectMessage] Decryption failed for message ${message.id} (kind=${message.message_kind}, scheme=${message.crypto_scheme}):`,
      decryptionError
    )
    const isOutgoing = message.sender_device_id === currentDeviceId
    const cached = isOutgoing ? lookupSentPlaintext(message.client_id) : null

    // If we resolved the plaintext from the sent-message cache, also persist it
    // in the decrypted-plaintext cache so subsequent re-projections (and the
    // IndexedDB write) use the correct text instead of the error placeholder.
    if (cached) {
      cacheDecryptedPlaintext(message.id, cached.text, cached.attachment)
    }

    return {
      id: message.id,
      clientId: message.client_id,
      replyToMessageId: message.reply_to_message_id ?? undefined,
      text: cached?.text ?? '[Encrypted envelope available but not decryptable on this device]',
      sentAt: message.inserted_at,
      pinnedAt: message.pinned_at ?? undefined,
      editedAt: message.edited_at ?? undefined,
      deletedAt: message.deleted_at ?? undefined,
      side: isOutgoing ? 'outgoing' : 'incoming',
      senderId: message.sender_device_id,
      senderUsername: message.sender_username ?? undefined,
      decryptable: !!cached,
      attachment: cached?.attachment,
      reactions: message.reactions.map((reaction) => ({
        reactionKey: reaction.reaction_key,
        count: reaction.count,
        reacted: reaction.reacted
      }))
    }
  }
}
