import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatSummary } from '../lib/api'
import {
  createDirectChat,
  createGroupChat,
  fetchMe,
  listChats,
  listDevices
} from '../lib/api'
import { mergeChat } from '../utils/chat-helpers'
import { useAppContext } from '../contexts/AppContext'

export type UseChatListParams = {
  view: string
  setProfileUsername: (username: string | null) => void
  setDevices: (devices: import('../lib/api').DeviceInfo[]) => void
}

export function useChatList(params: UseChatListParams) {
  const { storedDevice, setBanner, setLoading } = useAppContext()
  const { view, setProfileUsername, setDevices } = params

  const [chatItems, setChatItems] = useState<ChatSummary[]>([])
  const [chatFilter, setChatFilter] = useState('')
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [newChatUsername, setNewChatUsername] = useState('')
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [newGroupMembers, setNewGroupMembers] = useState('')

  const chatButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const chatFilterInputRef = useRef<HTMLInputElement | null>(null)
  const directChatInputRef = useRef<HTMLInputElement | null>(null)
  const groupTitleInputRef = useRef<HTMLInputElement | null>(null)
  const activeChatIdRef = useRef<string | null>(null)

  const deferredActiveChatId = useDeferredValue(activeChatId)
  const normalizedChatFilter = chatFilter.trim().toLowerCase()
  const visibleChatItems =
    normalizedChatFilter === ''
      ? chatItems
      : chatItems.filter((chat) => chat.title.toLowerCase().includes(normalizedChatFilter))
  const activeChat =
    chatItems.find((chat) => chat.id === deferredActiveChatId) ?? chatItems[0] ?? null

  // Sync newChatUsername default from storedDevice
  useEffect(() => {
    const nextDefault = storedDevice?.username ?? ''
    setNewChatUsername((current) => (current === '' ? nextDefault : current))
  }, [storedDevice])

  // Active chat id ref sync
  useEffect(() => {
    activeChatIdRef.current = deferredActiveChatId
  }, [deferredActiveChatId])

  // Chat shell bootstrap
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

        if (nextChats.length === 0) {
          const created = await createDirectChat(sessionToken, me.user.username)
          nextChats = [created.chat]
        }

        if (cancelled) {
          return
        }

        setProfileUsername(me.user.username)
        setChatItems(nextChats)
        setActiveChatId((current) => current ?? nextChats[0]?.id ?? null)
        setDevices(deviceResponse.devices)

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
  }, [storedDevice, view])

  function focusRelativeChat(offset: number) {
    const navigableChats = visibleChatItems

    if (navigableChats.length === 0) {
      return
    }

    const currentIndex = activeChat
      ? navigableChats.findIndex((chat) => chat.id === activeChat.id)
      : 0
    const safeIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = (safeIndex + offset + navigableChats.length) % navigableChats.length
    const nextChat = navigableChats[nextIndex]

    setActiveChatId(nextChat.id)

    window.requestAnimationFrame(() => {
      chatButtonRefs.current[nextChat.id]?.focus()
    })
  }

  async function handleCreateDirectChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!storedDevice) {
      return
    }

    setLoading(true)

    try {
      const response = await createDirectChat(storedDevice.sessionToken, newChatUsername)
      setChatItems((current) => mergeChat(current, response.chat))
      setActiveChatId(response.chat.id)
      setBanner({ tone: 'success', message: `Direct chat ready: ${response.chat.title}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create direct chat.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateGroupChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!storedDevice || newGroupTitle.trim() === '') {
      return
    }

    setLoading(true)

    try {
      const members = newGroupMembers
        .split(',')
        .map((member) => member.trim())
        .filter(Boolean)
      const response = await createGroupChat(storedDevice.sessionToken, {
        title: newGroupTitle.trim(),
        members
      })

      setChatItems((current) => mergeChat(current, response.chat))
      setActiveChatId(response.chat.id)
      setNewGroupTitle('')
      setNewGroupMembers('')
      setBanner({ tone: 'success', message: `Group ready: ${response.chat.title}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create group chat.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

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
    chatButtonRefs,
    chatFilterInputRef,
    directChatInputRef,
    groupTitleInputRef,
    activeChatIdRef,
    deferredActiveChatId,
    activeChat,
    visibleChatItems,
    normalizedChatFilter,
    focusRelativeChat,
    handleCreateDirectChat,
    handleCreateGroupChat
  }
}
