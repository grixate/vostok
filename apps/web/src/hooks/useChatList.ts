import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from 'react'
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
import { subscribeToUserStream } from '../lib/realtime.ts'
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

type ChatListOptions = {
  onExistingChatActivity?: (chatId: string) => void
}

export function useChatList(view: AuthView, options?: ChatListOptions) {
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

  // Track the user ID obtained from fetchMe so the user-channel subscription
  // effect can reference it without re-running the bootstrap.
  const userIdRef = useRef<string | null>(null)

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

        userIdRef.current = me.user.id
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

  // Subscribe to the user channel for real-time chat activity notifications.
  // When another user sends the first message in a new chat, the server
  // broadcasts `chat:activity` to every member's `user:#{user_id}` channel.
  // If the chat isn't in our list yet, we refresh the full chat list.
  useEffect(() => {
    if (view !== 'chat' || !storedDevice || !userIdRef.current) {
      return
    }

    const userId = userIdRef.current
    const { sessionToken } = storedDevice

    const onExistingChatActivity = options?.onExistingChatActivity

    const unsubscribe = subscribeToUserStream(sessionToken, userId, {
      onChatActivity(chatId) {
        setChatItems((currentChats) => {
          // If the chat is already in the list, notify the parent so it can
          // update the sidebar preview (e.g. decrypt the latest message for
          // non-active chats).  The existing `chat:${chatId}` subscription
          // handles message updates for the active chat.
          if (currentChats.some((c) => c.id === chatId)) {
            onExistingChatActivity?.(chatId)
            return currentChats
          }

          // New chat we haven't seen — fetch the full list so we pick up
          // the chat summary (title, type, members, etc.).
          listChats(sessionToken)
            .then((response) => {
              setChatItems((prev) => {
                const existingIds = new Set(prev.map((c) => c.id))
                const newChats = response.chats.filter((c) => !existingIds.has(c.id))

                if (newChats.length === 0) {
                  return prev
                }

                return [
                  ...prev.filter((c) => c.is_self_chat),
                  ...newChats,
                  ...prev.filter((c) => !c.is_self_chat)
                ]
              })
            })
            .catch(() => {
              // Silently ignore — the user can always manually refresh.
            })

          return currentChats
        })
      }
    })

    return unsubscribe
  }, [storedDevice, view, chatItems.length])

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
