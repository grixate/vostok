import type { ChatSummary } from './api.ts'
import type { AuthSession, ServerInfo, StoredDevice } from '../types.ts'

export type QualifiedChatId = `${string}::${string}`

export type ServerConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'auth_required'
  | 'error'

export type ServerEntry = {
  id: string
  label: string
  url: string
  color: string
  auth: AuthSession | null
  device: StoredDevice | null
  serverInfo: ServerInfo | null
  lastConnectedAt: string | null
  sortOrder: number
  enabled: boolean
}

export type MergedChatSummary = ChatSummary & {
  rawId: string
  serverId: string
  qualifiedId: QualifiedChatId
  serverLabel: string
  serverColor: string
  serverUrl: string
}

export function qualifyChatId(serverId: string, chatId: string): QualifiedChatId {
  return `${serverId}::${chatId}` as QualifiedChatId
}

export function isQualifiedChatId(value: string | null | undefined): value is QualifiedChatId {
  return typeof value === 'string' && value.includes('::')
}

export function parseQualifiedChatId(qualifiedChatId: QualifiedChatId): {
  serverId: string
  chatId: string
} {
  const separatorIndex = qualifiedChatId.indexOf('::')

  if (separatorIndex < 0) {
    return { serverId: '', chatId: qualifiedChatId }
  }

  return {
    serverId: qualifiedChatId.slice(0, separatorIndex),
    chatId: qualifiedChatId.slice(separatorIndex + 2)
  }
}

export function getServerIdFromQualifiedChatId(chatId: string | null | undefined): string | null {
  if (!chatId || !isQualifiedChatId(chatId)) {
    return null
  }

  return parseQualifiedChatId(chatId).serverId || null
}

export function getRawChatId(chatId: string | null | undefined): string | null {
  if (!chatId) {
    return null
  }

  if (!isQualifiedChatId(chatId)) {
    return chatId
  }

  return parseQualifiedChatId(chatId).chatId
}

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim()

  if (trimmed === '') {
    return ''
  }

  try {
    const normalized = new URL(trimmed)
    normalized.hash = ''
    normalized.pathname = normalized.pathname.replace(/\/+$/, '')
    return normalized.toString().replace(/\/+$/, '')
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function toMergedChatSummary(server: ServerEntry, chat: ChatSummary): MergedChatSummary {
  const qualifiedId = qualifyChatId(server.id, chat.id)

  return {
    ...chat,
    id: qualifiedId,
    rawId: chat.id,
    serverId: server.id,
    qualifiedId,
    serverLabel: server.label,
    serverColor: server.color,
    serverUrl: server.url
  }
}

export function sortMergedChats(chats: MergedChatSummary[]): MergedChatSummary[] {
  return [...chats].sort((left, right) => {
    const leftTime = left.latest_message_at ?? ''
    const rightTime = right.latest_message_at ?? ''
    return rightTime.localeCompare(leftTime)
  })
}

export function defaultServerLabel(serverInfoName: string | null | undefined): string {
  const trimmed = serverInfoName?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : 'My Server'
}

