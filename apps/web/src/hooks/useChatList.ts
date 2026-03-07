import { useState, useEffect, type FormEvent } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type { ChatSummary } from '../lib/api.ts'
import {
  listChats,
  createDirectChat,
  listDevices,
  fetchMe
} from '../lib/api.ts'
import { mergeChat } from '../utils/chat-helpers.ts'
import type { AuthView } from '../types.ts'

export function useChatList(view: AuthView) {
  const { storedDevice, setLoading, setBanner, loading } = useAppContext()
  const [chatItems, setChatItems] = useState<ChatSummary[]>([])
  const [chatFilter, setChatFilter] = useState('')
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [newChatUsername, setNewChatUsername] = useState('')
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [newGroupMembers, setNewGroupMembers] = useState('')
  const [newMessageMode, setNewMessageMode] = useState(false)

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
          const created = await createDirectChat(sessionToken, me.user.username)
          nextChats = [created.chat, ...nextChats]
        }

        if (cancelled) {
          return
        }

        setChatItems(nextChats)
        setActiveChatId((current) => current ?? nextChats[0]?.id ?? null)
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
    startDirectChatWith,
    handleCreateDirectChat
  }
}
