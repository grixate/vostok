import type { ChatSummary } from '../lib/api.ts'
import type { CachedMessage } from '../lib/message-cache.ts'

export function mergeChat<T extends ChatSummary>(current: T[], next: Partial<T> & ChatSummary): T[] {
  const existing = current.find((chat) => chat.id === next.id)
  const filtered = current.filter((chat) => chat.id !== next.id)
  const merged = existing ? { ...existing, ...next } : next
  return [merged as T, ...filtered]
}

export function syncChatSummary<T extends ChatSummary>(
  current: T[],
  chatId: string,
  messages: CachedMessage[],
  isActiveChat = true
): T[] {
  const chat = current.find((entry) => entry.id === chatId)

  if (!chat) {
    return current
  }

  const latestMessageAt = messages.at(-1)?.sentAt ?? chat.latest_message_at
  // Only clear unread count when the chat is currently being viewed.
  const messageCount = isActiveChat ? 0 : (chat.message_count ?? 0) + messages.length
  const updated = { ...chat, latest_message_at: latestMessageAt, message_count: messageCount }

  // Only reorder to top when a genuinely new message arrived.
  // If latest_message_at didn't change, update in-place to avoid jumpy sidebar.
  if (latestMessageAt === chat.latest_message_at) {
    return current.map((c) => (c.id === chatId ? updated : c))
  }

  return mergeChat(current, updated)
}

export function compareMessageOrder(left: CachedMessage, right: CachedMessage): number {
  const leftTime = Date.parse(left.sentAt)
  const rightTime = Date.parse(right.sentAt)

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return left.sentAt.localeCompare(right.sentAt)
  }

  return leftTime - rightTime
}
