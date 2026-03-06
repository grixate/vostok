/**
 * Pure, stateless helper functions shared across hooks.
 * No React, no async, no crypto — just data manipulation.
 */

import type { CachedMessage } from '../../lib/message-cache'
import type { ChatSummary, LinkMetadata, SafetyNumberRecord } from '../../lib/api'
import type { AttachmentDescriptor, SafetyNumberEntry } from '../types/chat'

// ── Chat list helpers ─────────────────────────────────────────────────────────

export function mergeChat(current: ChatSummary[], next: ChatSummary): ChatSummary[] {
  const filtered = current.filter((chat) => chat.id !== next.id)
  return [next, ...filtered]
}

export function syncChatSummary(
  current: ChatSummary[],
  chatId: string,
  messages: CachedMessage[]
): ChatSummary[] {
  const chat = current.find((entry) => entry.id === chatId)

  if (!chat) {
    return current
  }

  const latestMessageAt = messages.at(-1)?.sentAt ?? chat.latest_message_at

  return mergeChat(current, {
    ...chat,
    latest_message_at: latestMessageAt,
    message_count: messages.length
  })
}

// ── Message thread helpers ────────────────────────────────────────────────────

export function compareMessageOrder(left: CachedMessage, right: CachedMessage): number {
  const leftTime = Date.parse(left.sentAt)
  const rightTime = Date.parse(right.sentAt)

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return left.sentAt.localeCompare(right.sentAt)
  }

  return leftTime - rightTime
}

export function mergeMessageThread(
  current: CachedMessage[],
  next: CachedMessage
): CachedMessage[] {
  const filtered = current.filter((message) => {
    if (message.id === next.id) return false
    if (next.clientId && message.clientId === next.clientId) return false
    return true
  })

  return [...filtered, next].sort(compareMessageOrder)
}

export function pickPinnedMessage(messages: CachedMessage[]): CachedMessage | null {
  const pinnedMessages = messages.filter((message) => message.pinnedAt && !message.deletedAt)

  if (pinnedMessages.length === 0) {
    return null
  }

  return [...pinnedMessages].sort((left, right) => {
    const leftTime = Date.parse(left.pinnedAt ?? left.sentAt)
    const rightTime = Date.parse(right.pinnedAt ?? right.sentAt)

    if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
      return (right.pinnedAt ?? right.sentAt).localeCompare(left.pinnedAt ?? left.sentAt)
    }

    return rightTime - leftTime
  })[0]
}

export function resolvePinnedPreview(message: CachedMessage): string {
  const preview = message.text.trim()

  if (preview.length === 0) {
    return 'Encrypted message'
  }

  return preview.length > 96 ? `${preview.slice(0, 93)}...` : preview
}

export function resolveReplyPreview(
  messages: CachedMessage[],
  replyToMessageId: string
): string {
  const target = messages.find((message) => message.id === replyToMessageId)

  if (!target) {
    return 'an earlier message'
  }

  const preview = target.text.trim()

  if (preview.length === 0) {
    return 'an earlier message'
  }

  return preview.length > 64 ? `${preview.slice(0, 61)}...` : preview
}

// ── Outbox error predicates ───────────────────────────────────────────────────

export function shouldQueueOutboxSendFailure(message: string): boolean {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('required') ||
    normalized.includes('must ') ||
    normalized.includes('must be') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('not found') ||
    normalized.includes('sender key') ||
    normalized.includes('session transport') ||
    normalized.includes('already been taken')
  ) {
    return false
  }

  return true
}

export function isOutboxDuplicateClientIdError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('client') && normalized.includes('already been taken')
}

// ── Attachment helpers ────────────────────────────────────────────────────────

export function toAttachmentDescriptor(
  attachment: NonNullable<CachedMessage['attachment']>
): AttachmentDescriptor {
  if (!attachment.contentKeyBase64 || !attachment.ivBase64) {
    throw new Error('The attachment is missing local decryption material.')
  }

  return {
    kind: 'attachment',
    uploadId: attachment.uploadId,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    size: attachment.size,
    thumbnailDataUrl: attachment.thumbnailDataUrl,
    waveform: attachment.waveform,
    contentKeyBase64: attachment.contentKeyBase64,
    ivBase64: attachment.ivBase64
  }
}

export function isVoiceNoteAttachment(
  attachment: Pick<NonNullable<CachedMessage['attachment']>, 'fileName' | 'contentType'>
): boolean {
  return attachment.contentType.startsWith('audio/') && attachment.fileName.startsWith('voice-note-')
}

export function isRoundVideoAttachment(
  attachment: Pick<NonNullable<CachedMessage['attachment']>, 'fileName' | 'contentType'>
): boolean {
  return (
    attachment.contentType.startsWith('video/') && attachment.fileName.startsWith('round-video-')
  )
}

export function inferMediaKind(contentType: string): 'file' | 'image' | 'audio' | 'video' {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('audio/')) return 'audio'
  if (contentType.startsWith('video/')) return 'video'
  return 'file'
}

// ── Link preview helpers ──────────────────────────────────────────────────────

export function extractFirstHttpUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i)

  if (!match) {
    return null
  }

  try {
    return new URL(match[0]).href
  } catch {
    return null
  }
}

export function resolveLinkPreview(
  text: string,
  metadata: LinkMetadata | null
): { href: string; hostname: string; title: string; description: string | null } | null {
  const href = extractFirstHttpUrl(text)

  if (!href) {
    return null
  }

  try {
    const url = new URL(href)
    const hostname = url.hostname.replace(/^www\./i, '')
    const fallbackPath = url.pathname === '/' ? '' : url.pathname
    const fallbackTitle = `${hostname}${fallbackPath}`.slice(0, 96) || href
    const title = metadata?.title?.trim() || fallbackTitle
    const description = metadata?.description?.trim() || metadata?.canonical_url?.trim() || null

    return {
      href,
      hostname: metadata?.hostname || hostname,
      title,
      description
    }
  } catch {
    return null
  }
}

// ── Safety number helpers ─────────────────────────────────────────────────────

export function toSafetyNumberEntry(record: SafetyNumberRecord): SafetyNumberEntry {
  return {
    peerDeviceId: record.peer_device_id,
    peerUsername: record.peer_username,
    peerDeviceName: record.peer_device_name,
    label: `${record.peer_username} • ${record.peer_device_name}`,
    fingerprint: record.fingerprint,
    verified: record.verified,
    verifiedAt: record.verified_at
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatRelativeTime(value: string | null): string {
  if (!value) {
    return 'Now'
  }

  const timestamp = new Date(value)

  if (Number.isNaN(timestamp.getTime())) {
    return 'Now'
  }

  return timestamp.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatMediaClock(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '0:00'
  }

  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function truncateSignalPayload(payload: string): string {
  return payload.length > 88 ? `${payload.slice(0, 85)}...` : payload
}
