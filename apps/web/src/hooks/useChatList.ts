import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import { createDirectChat } from '../lib/api.ts'
import { getServerIdFromQualifiedChatId, qualifyChatId, type MergedChatSummary } from '../lib/multi-server.ts'
import type { useServers } from './useServers.ts'
import type { AuthView } from '../types.ts'

const ACTIVE_CHAT_STORAGE_KEY = 'vostok.layout.active_chat_id'

function readPersistedActiveChatId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

function persistActiveChatId(chatId: string | null) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (chatId) {
      window.localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, chatId)
    } else {
      window.localStorage.removeItem(ACTIVE_CHAT_STORAGE_KEY)
    }
  } catch {
    // Ignore storage errors gracefully.
  }
}

function toRawChat(chat: MergedChatSummary) {
  return {
    id: chat.rawId,
    type: chat.type,
    title: chat.title,
    participant_usernames: chat.participant_usernames,
    participant_user_ids: chat.participant_user_ids,
    is_self_chat: chat.is_self_chat,
    latest_message_at: chat.latest_message_at,
    message_count: chat.message_count
  }
}

function isDirectChatOnline(
  chat: MergedChatSummary,
  currentUserId: string | null,
  isUserOnline: (serverId: string, userId: string) => boolean
) {
  if (chat.is_self_chat || chat.type === 'group') {
    return false
  }

  const otherUserId = chat.participant_user_ids?.find((id) => id !== currentUserId) ?? null
  return otherUserId ? isUserOnline(chat.serverId, otherUserId) : false
}

export function useChatList(
  view: AuthView,
  servers: ReturnType<typeof useServers>
) {
  const { sessionToken, setLoading, setBanner } = useAppContext()
  const [chatFilter, setChatFilter] = useState('')
  const [activeChatId, _setActiveChatId] = useState<string | null>(() => readPersistedActiveChatId())
  const [newChatUsername, setNewChatUsername] = useState('')
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [newGroupMembers, setNewGroupMembers] = useState('')
  const [newMessageMode, setNewMessageMode] = useState(false)

  const chatItems = servers.mergedChats

  const setChatItems = useCallback(
    (valueOrUpdater: React.SetStateAction<MergedChatSummary[]>) => {
      const next = typeof valueOrUpdater === 'function'
        ? valueOrUpdater(servers.mergedChats)
        : valueOrUpdater

      const grouped = new Map<string, MergedChatSummary[]>()
      for (const chat of next) {
        const group = grouped.get(chat.serverId) ?? []
        group.push(chat)
        grouped.set(chat.serverId, group)
      }

      for (const server of servers.servers) {
        const chats = grouped.get(server.id) ?? []
        servers.updateChatsForServer(server.id, chats.map(toRawChat))
      }
    },
    [servers]
  )

  const setActiveChatId = useCallback(
    (valueOrUpdater: string | null | ((current: string | null) => string | null)) => {
      _setActiveChatId((current) => {
        const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(current) : valueOrUpdater
        persistActiveChatId(next)
        return next
      })
    },
    []
  )

  // Sync active server when active chat changes — kept outside the
  // setState updater to avoid dispatching cross-component state updates
  // during React's render phase (which causes "Maximum update depth" errors).
  useEffect(() => {
    const serverId = getServerIdFromQualifiedChatId(activeChatId)
    if (serverId) {
      servers.setActiveServerId(serverId)
    }
  }, [activeChatId, servers.setActiveServerId])

  useEffect(() => {
    if (view !== 'chat') {
      return
    }

    setActiveChatId((current) => {
      if (current && chatItems.some((chat) => chat.id === current)) {
        return current
      }
      return chatItems[0]?.id ?? null
    })
  }, [chatItems, setActiveChatId, view])

  async function startDirectChatWith(username: string) {
    if (!sessionToken) {
      return
    }

    setLoading(true)

    try {
      const response = await createDirectChat(sessionToken, username)
      const activeServer = servers.activeServer

      if (!activeServer) {
        throw new Error('No active server is available for new chats.')
      }

      servers.updateChatForServer(activeServer.id, response.chat)
      setActiveChatId(qualifyChatId(activeServer.id, response.chat.id))
      setNewChatUsername('')
      setNewMessageMode(false)
      setBanner({ tone: 'success', message: `Direct chat ready: ${response.chat.title}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create direct chat.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateDirectChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await startDirectChatWith(newChatUsername)
  }

  const normalizedChatFilter = chatFilter.trim().toLowerCase()
  const visibleChatItems =
    normalizedChatFilter === ''
      ? chatItems
      : chatItems.filter((chat) => {
          const haystacks = [
            chat.title,
            chat.serverLabel,
            ...chat.participant_usernames
          ]
          return haystacks.some((value) => value.toLowerCase().includes(normalizedChatFilter))
        })

  const recentContacts = useMemo(
    () =>
      chatItems
        .filter((chat) => chat.type === 'direct' && !chat.is_self_chat)
        .map((chat) => ({
          username: chat.title,
          chatId: chat.id,
          latestMessageAt: chat.latest_message_at,
          serverLabel: chat.serverLabel
        }))
        .sort((left, right) => {
          if (left.latestMessageAt && right.latestMessageAt) {
            return right.latestMessageAt.localeCompare(left.latestMessageAt)
          }
          if (left.latestMessageAt) return -1
          if (right.latestMessageAt) return 1
          return left.username.localeCompare(right.username)
        }),
    [chatItems]
  )

  const isChatOnline = useCallback((chat: MergedChatSummary) => {
    const currentUserId =
      servers.servers.find((server) => server.id === chat.serverId)?.auth?.user.id ?? null
    return isDirectChatOnline(chat, currentUserId, servers.isUserOnline)
  }, [servers])

  return {
    chatItems,
    setChatItems,
    chatFilter,
    setChatFilter,
    activeChatId,
    setActiveChatId,
    newChatUsername,
    setNewChatUsername,
    newGroupTitle,
    setNewGroupTitle,
    newGroupMembers,
    setNewGroupMembers,
    newMessageMode,
    setNewMessageMode,
    visibleChatItems,
    recentContacts,
    hasMultipleServers: servers.servers.length > 1,
    activeServerId: servers.activeServerId,
    activeServerUrl: servers.activeServer?.url ?? null,
    resolveServerScope: servers.resolveServerForChat,
    isChatOnline,
    startDirectChatWith,
    handleCreateDirectChat
  }
}
