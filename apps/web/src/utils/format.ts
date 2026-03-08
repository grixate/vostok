import type { LinkMetadata } from '../lib/api.ts'
import type { CachedMessage } from '../lib/message-cache.ts'

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

export function resolveReplyPreview(messages: CachedMessage[], replyToMessageId: string): string {
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
