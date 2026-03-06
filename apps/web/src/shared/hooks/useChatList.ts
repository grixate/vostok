/**
 * Chat list state hook — owns chatItems, chatFilter, activeChatId, the form
 * inputs for creating new chats, and the bootstrap shell effect.
 */

import { startTransition, useDeferredValue, useRef, useState } from 'react'
import { createDirectChat, createGroupChat, fetchMe, listChats, listDevices } from '../../lib/api'
import type { ChatSummary, DeviceInfo } from '../../lib/api'
import { mergeChat } from '../lib/chat-utils'
import type { AuthView, StoredDevice } from '../context/AuthContext'
import type { Banner } from '../types/chat'
import type { FormEvent } from 'react'
import { useEffect } from 'react'

// ── Public interface ──────────────────────────────────────────────────────────

export interface ChatListHookResult {
  // ── State ──────────────────────────────────────────────────────────────────
  chatItems: ChatSummary[]
  setChatItems: React.Dispatch<React.SetStateAction<ChatSummary[]>>
  chatFilter: string
  setChatFilter: (v: string) => void
  activeChatId: string | null
  setActiveChatId: (id: string | null) => void
  // ── Derived ────────────────────────────────────────────────────────────────
  deferredActiveChatId: string | null
  activeChat: ChatSummary | null
  visibleChatItems: ChatSummary[]
  contacts: Array<{ username: string }>
  // ── Form inputs for compose UI ─────────────────────────────────────────────
  newChatUsername: string
  setNewChatUsername: React.Dispatch<React.SetStateAction<string>>
  newGroupTitle: string
  setNewGroupTitle: React.Dispatch<React.SetStateAction<string>>
  newGroupMembers: string
  setNewGroupMembers: React.Dispatch<React.SetStateAction<string>>
  // ── Refs ───────────────────────────────────────────────────────────────────
  chatButtonRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>
  chatFilterInputRef: React.RefObject<HTMLInputElement | null>
  directChatInputRef: React.RefObject<HTMLInputElement | null>
  groupTitleInputRef: React.RefObject<HTMLInputElement | null>
  // ── Handlers ───────────────────────────────────────────────────────────────
  /** Create a 1:1 chat by username — used from ComposeView. */
  handleCreateDirectChatByUsername: (username: string) => Promise<void>
  /** Create a group chat by title + member list — used from NewGroupView. */
  handleCreateGroupFromNav: (title: string, members: string[]) => Promise<void>
  /** Form submit handler for the legacy direct-chat compose form. */
  handleCreateDirectChat: (event: FormEvent<HTMLFormElement>) => Promise<void>
  /** Form submit handler for the legacy group-chat compose form. */
  handleCreateGroupChat: (event: FormEvent<HTMLFormElement>) => Promise<void>
  /** Move keyboard focus to a chat offset positions away from the current one. */
  focusRelativeChat: (offset: number) => void
  /** Resets all chat list state (called from handleForgetDevice). */
  reset: () => void
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseChatListParams {
  storedDevice: StoredDevice | null
  view: AuthView
  profileUsername: string | null
  setLoading: (b: boolean) => void
  setBanner: (b: Banner | null) => void
  /** Called after the bootstrap effect resolves the device list. */
  onDevicesLoaded: (devices: DeviceInfo[]) => void
  /** Called after the bootstrap effect confirms admin status. */
  onIsAdminResolved: (isAdmin: boolean) => void
  /** Called after the bootstrap effect resolves the server-side username. */
  onProfileUsernameResolved: (username: string) => void
}

export function useChatList({
  storedDevice,
  view,
  profileUsername,
  setLoading,
  setBanner,
  onDevicesLoaded,
  onIsAdminResolved,
  onProfileUsernameResolved,
}: UseChatListParams): ChatListHookResult {
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

  const deferredActiveChatId = useDeferredValue(activeChatId)

  // ── Derived ────────────────────────────────────────────────────────────────

  const activeChat =
    chatItems.find((chat) => chat.id === deferredActiveChatId) ?? chatItems[0] ?? null

  const normalizedChatFilter = chatFilter.trim().toLowerCase()
  const visibleChatItems =
    normalizedChatFilter === ''
      ? chatItems
      : chatItems.filter((chat) => chat.title.toLowerCase().includes(normalizedChatFilter))

  const contacts = Array.from(
    new Set(
      chatItems
        .filter((chat) => !chat.is_self_chat && chat.title !== (profileUsername ?? ''))
        .map((chat) => chat.title)
    )
  ).map((username) => ({ username }))

  // ── Bootstrap effect ───────────────────────────────────────────────────────
  // Fires when the user is authenticated and in chat view.
  // Fetches the profile, chat list, and device list in parallel.

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
          listDevices(sessionToken),
        ])
        let nextChats = chatResponse.chats

        if (nextChats.length === 0) {
          const created = await createDirectChat(sessionToken, me.user.username)
          nextChats = [created.chat]
        }

        if (cancelled) {
          return
        }

        onProfileUsernameResolved(me.user.username)
        onIsAdminResolved(me.user.is_admin ?? false)
        onDevicesLoaded(deviceResponse.devices)
        setChatItems(nextChats)
        setActiveChatId((current) => current ?? nextChats[0]?.id ?? null)
        setNewChatUsername((current) => (current === '' ? me.user.username : current))

        if (me.device.prekeys?.replenish_recommended) {
          setBanner({
            tone: 'info',
            message: `One-time prekeys are low (${me.device.prekeys.available_one_time_prekeys}/${me.device.prekeys.target_count}). Rotate prekeys soon.`,
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
  }, [storedDevice, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleCreateDirectChatByUsername(username: string) {
    if (!storedDevice || !username.trim()) return

    setLoading(true)
    try {
      const response = await createDirectChat(storedDevice.sessionToken, username.trim())
      setChatItems((current) => mergeChat(current, response.chat))
      startTransition(() => setActiveChatId(response.chat.id))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start chat.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateGroupFromNav(title: string, members: string[]) {
    if (!storedDevice || !title.trim()) return

    setLoading(true)
    try {
      const response = await createGroupChat(storedDevice.sessionToken, {
        title: title.trim(),
        members,
      })
      setChatItems((current) => mergeChat(current, response.chat))
      startTransition(() => setActiveChatId(response.chat.id))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create group.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
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
      startTransition(() => setActiveChatId(response.chat.id))
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
        members,
      })

      setChatItems((current) => mergeChat(current, response.chat))
      startTransition(() => setActiveChatId(response.chat.id))
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

    startTransition(() => setActiveChatId(nextChat.id))

    window.requestAnimationFrame(() => {
      chatButtonRefs.current[nextChat.id]?.focus()
    })
  }

  function reset() {
    setChatItems([])
    setChatFilter('')
    setActiveChatId(null)
    setNewChatUsername('')
    setNewGroupTitle('')
    setNewGroupMembers('')
  }

  return {
    chatItems,
    setChatItems,
    chatFilter,
    setChatFilter,
    activeChatId,
    setActiveChatId,
    deferredActiveChatId,
    activeChat,
    visibleChatItems,
    contacts,
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
    handleCreateDirectChatByUsername,
    handleCreateGroupFromNav,
    handleCreateDirectChat,
    handleCreateGroupChat,
    focusRelativeChat,
    reset,
  }
}
