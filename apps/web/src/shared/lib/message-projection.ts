/**
 * Async message projection: ChatMessage (server shape) → CachedMessage (local shape).
 * Also contains session material helpers that bridge StoredDevice ↔ chat-session-vault.
 */

import type { CachedMessage } from '../../lib/message-cache'
import type { ChatMessage, ChatDeviceSession, RecipientDevice } from '../../lib/api'
import type { StoredDevice } from '../context/AuthContext'
import type { LocalSessionDeviceMaterial } from '../../lib/chat-session-vault'
import type { AttachmentDescriptor } from '../types/chat'
import { decryptMessageText } from '../../lib/message-vault'
import { base64ToBytes } from '../../lib/base64'

// ── Payload parsing ───────────────────────────────────────────────────────────

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
      (typeof parsed.thumbnailDataUrl === 'undefined' ||
        typeof parsed.thumbnailDataUrl === 'string') &&
      (typeof parsed.waveform === 'undefined' ||
        (Array.isArray(parsed.waveform) &&
          parsed.waveform.every((value) => typeof value === 'number'))) &&
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

  return { text: plaintext }
}

function decodeSystemMessageText(payloadBase64: string): string {
  try {
    return new TextDecoder().decode(base64ToBytes(payloadBase64))
  } catch {
    return '[System event unavailable]'
  }
}

// ── Message projection ────────────────────────────────────────────────────────

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
      decryptable: true,
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
      decryptable: true,
      attachment: parsedPayload.attachment,
      reactions: message.reactions.map((reaction) => ({
        reactionKey: reaction.reaction_key,
        count: reaction.count,
        reacted: reaction.reacted
      }))
    }
  } catch {
    return {
      id: message.id,
      clientId: message.client_id,
      replyToMessageId: message.reply_to_message_id ?? undefined,
      text: '[Encrypted envelope available but not decryptable on this device]',
      sentAt: message.inserted_at,
      pinnedAt: message.pinned_at ?? undefined,
      editedAt: message.edited_at ?? undefined,
      deletedAt: message.deleted_at ?? undefined,
      side: message.sender_device_id === currentDeviceId ? 'outgoing' : 'incoming',
      decryptable: false,
      reactions: message.reactions.map((reaction) => ({
        reactionKey: reaction.reaction_key,
        count: reaction.count,
        reacted: reaction.reacted
      }))
    }
  }
}

// ── Session material helpers ──────────────────────────────────────────────────

export function toLocalSessionDeviceMaterial(
  storedDevice: StoredDevice
): LocalSessionDeviceMaterial {
  return {
    deviceId: storedDevice.deviceId,
    encryptionPrivateKeyPkcs8Base64: storedDevice.encryptionPrivateKeyPkcs8Base64,
    signedPrekeyPublicKeyBase64: storedDevice.signedPrekeyPublicKeyBase64,
    signedPrekeyPrivateKeyPkcs8Base64: storedDevice.signedPrekeyPrivateKeyPkcs8Base64,
    signedPrekeys:
      storedDevice.signedPrekeys ??
      (storedDevice.signedPrekeyPublicKeyBase64 && storedDevice.signedPrekeyPrivateKeyPkcs8Base64
        ? [
            {
              publicKeyBase64: storedDevice.signedPrekeyPublicKeyBase64,
              privateKeyPkcs8Base64: storedDevice.signedPrekeyPrivateKeyPkcs8Base64
            }
          ]
        : []),
    oneTimePrekeys: storedDevice.oneTimePrekeys
  }
}

export function canUseChatSessions(
  storedDevice: StoredDevice,
  sessions: ChatDeviceSession[],
  recipientDevices: RecipientDevice[]
): boolean {
  if (!storedDevice.encryptionPrivateKeyPkcs8Base64) {
    return false
  }

  const outboundRecipientIds = new Set(
    sessions
      .filter(
        (session) =>
          session.initiator_device_id === storedDevice.deviceId &&
          session.session_state !== 'superseded'
      )
      .map((session) => session.recipient_device_id)
  )

  return recipientDevices.every((device) => outboundRecipientIds.has(device.device_id))
}
