import type { ChatSummary } from '../lib/api.ts'
import type { CachedMessage } from '../lib/message-cache.ts'

export function mergeChat(current: ChatSummary[], next: ChatSummary): ChatSummary[] {
  const filtered = current.filter((chat) => chat.id !== next.id)
  return [next, ...filtered]
}

export function syncChatSummary(current: ChatSummary[], chatId: string, messages: CachedMessage[]): ChatSummary[] {
  const chat = current.find((entry) => entry.id === chatId)

  if (!chat) {
    return current
  }

  const latestMessageAt = messages.at(-1)?.sentAt ?? chat.latest_message_at
  const updated = { ...chat, latest_message_at: latestMessageAt, message_count: messages.length }

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
