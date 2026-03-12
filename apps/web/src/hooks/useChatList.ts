import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type { ChatSummary } from '../lib/api.ts'
import {
  listChats,
  createDirectChat,
  createSelfChat,
  listDevices,
  fetchMe
} from '../lib/api.ts'
import { mergeChat } from '../utils/chat-helpers.ts'
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

export function useChatList(view: AuthView) {
  const { storedDevice, setLoading, setBanner, loading } = useAppContext()
  const [chatItems, setChatItems] = useState<ChatSummary[]>([])
  const [chatFilter, setChatFilter] = useState('')
  const [activeChatId, _setActiveChatId] = useState<string | null>(() => readPersistedActiveChatId())
  const [newChatUsername, setNewChatUsername] = useState('')
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [newGroupMembers, setNewGroupMembers] = useState('')
  const [newMessageMode, setNewMessageMode] = useState(false)

  // Wrap setActiveChatId to persist the selection to localStorage
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

  useEffect(() => {
    if (view !== 'chat' || !storedDevice) {
      return
    }

    const { sessionToken } = storedDevice
    let cancelled = false

    async function bootstrapChatShell() {
      setLoading(true)

      try {
        const [me, chatResponse, deviceResponse] = await Promise.all([
          fetchMe(sessionToken),
          listChats(sessionToken),
          listDevices(sessionToken)
        ])
        let nextChats = chatResponse.chats

        if (!nextChats.some((c) => c.is_self_chat)) {
          const created = await createSelfChat(sessionToken)
          nextChats = [created.chat, ...nextChats]
        }

        // Always sort: self-chat first, then everything else by latest_message_at descending
        nextChats = [
          ...nextChats.filter((c) => c.is_self_chat),
          ...nextChats.filter((c) => !c.is_self_chat)
        ]

        if (cancelled) {
          return
        }

        setChatItems(nextChats)
        // Validate the persisted active chat ID: use it if the chat still exists,
        // otherwise fall back to the first chat in the list.
        setActiveChatId((current) => {
          if (current && nextChats.some((c) => c.id === current)) {
            return current
          }
          return nextChats[0]?.id ?? null
        })
        setNewChatUsername((current) => (current === '' ? me.user.username : current))

        if (me.device.prekeys?.replenish_recommended) {
          setBanner({
            tone: 'info',
            message: `One-time prekeys are low (${me.device.prekeys.available_one_time_prekeys}/${me.device.prekeys.target_count}). Rotate prekeys soon.`
          })
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load chats.'
          setBanner({ tone: 'error', message })
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void bootstrapChatShell()

    return () => {
      cancelled = true
    }
  }, [storedDevice, view, setLoading, setBanner])

  async function startDirectChatWith(username: string) {
    if (!storedDevice) return
    setLoading(true)
    try {
      const response = await createDirectChat(storedDevice.sessionToken, username)
      setChatItems((current) => mergeChat(current, response.chat))
      setActiveChatId(response.chat.id)
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
      : chatItems.filter((chat) => chat.title.toLowerCase().includes(normalizedChatFilter))

  // Contacts derived from existing direct chats (excludes self-chat).
  // Used by NewMessagePanel to show a searchable list of recent contacts.
  const recentContacts = useMemo(
    () =>
      chatItems
        .filter((c) => c.type === 'direct' && !c.is_self_chat)
        .map((c) => ({ username: c.title, chatId: c.id, latestMessageAt: c.latest_message_at }))
        .sort((a, b) => {
          if (a.latestMessageAt && b.latestMessageAt) {
            return b.latestMessageAt.localeCompare(a.latestMessageAt)
          }
          if (a.latestMessageAt) return -1
          if (b.latestMessageAt) return 1
          return a.username.localeCompare(b.username)
        }),
    [chatItems]
  )

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
    startDirectChatWith,
    handleCreateDirectChat
  }
}
