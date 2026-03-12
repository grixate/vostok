import { useEffect, useRef, useState } from 'react'
import type { ChatSummary } from '../lib/api.ts'
import type { CachedMessage } from '../lib/message-cache.ts'
import {
  requestNotificationPermission,
  sendNotification,
  isWindowFocused
} from '../lib/notifications.ts'

const NOTIFICATION_ENABLED_STORAGE_KEY = 'vostok.notifications.enabled'

function readNotificationPreference(): boolean {
  if (typeof window === 'undefined') {
    return true
  }

  const raw = window.localStorage.getItem(NOTIFICATION_ENABLED_STORAGE_KEY)

  if (raw === 'false') {
    return false
  }

  // Default to enabled
  return true
}

/**
 * Notification hook that fires desktop notifications for incoming messages
 * when the window is not focused.
 *
 * Responsibilities:
 * - Request notification permission on mount (after auth)
 * - Watch for new incoming messages in the active chat
 * - Send a notification when:
 *   - The window is NOT focused
 *   - The message is incoming (not outgoing/system)
 *   - The chat is not a self-chat
 *   - Notifications are enabled by the user
 * - Respect privacy: don't show message content for non-decryptable messages
 */
export function useNotifications(
  authenticated: boolean,
  messageItems: CachedMessage[],
  chatItems: ChatSummary[],
  activeChatId: string | null
) {
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => readNotificationPreference())
  const [permissionGranted, setPermissionGranted] = useState(false)
  const previousMessageIdsRef = useRef<Set<string>>(new Set())
  const initialLoadRef = useRef(true)

  // Request notification permission once authenticated
  useEffect(() => {
    if (!authenticated) {
      return
    }

    void requestNotificationPermission().then((granted) => {
      setPermissionGranted(granted)
    })
  }, [authenticated])

  // Persist notification preference
  useEffect(() => {
    window.localStorage.setItem(NOTIFICATION_ENABLED_STORAGE_KEY, String(notificationsEnabled))
  }, [notificationsEnabled])

  // Reset tracked message IDs when the active chat changes
  useEffect(() => {
    previousMessageIdsRef.current = new Set()
    initialLoadRef.current = true
  }, [activeChatId])

  // Watch for new incoming messages and send notifications
  useEffect(() => {
    if (!authenticated || !notificationsEnabled || !permissionGranted || !activeChatId) {
      return
    }

    const previousIds = previousMessageIdsRef.current
    const currentIds = new Set(messageItems.map((m) => m.id))

    // On the first load of messages for a chat, just record the IDs without notifying
    if (initialLoadRef.current) {
      previousMessageIdsRef.current = currentIds
      initialLoadRef.current = false
      return
    }

    // Find the active chat to check properties
    const activeChat = chatItems.find((c) => c.id === activeChatId)

    // Don't notify for self-chats (Saved Messages)
    if (activeChat?.is_self_chat) {
      previousMessageIdsRef.current = currentIds
      return
    }

    // Don't notify if the window is focused -- the user can already see the messages
    if (isWindowFocused()) {
      previousMessageIdsRef.current = currentIds
      return
    }

    // Find new incoming messages that weren't in the previous set
    const newIncomingMessages = messageItems.filter(
      (m) =>
        !previousIds.has(m.id) &&
        m.side === 'incoming' &&
        !m.id.startsWith('optimistic-') &&
        !m.deletedAt
    )

    for (const message of newIncomingMessages) {
      const chatTitle = activeChat?.title ?? 'Chat'

      // Respect privacy: if the message is not decryptable, show a generic body
      const body = message.decryptable ? message.text : 'New message'

      void sendNotification({
        title: chatTitle,
        body,
        chatId: activeChatId
      })
    }

    previousMessageIdsRef.current = currentIds
  }, [messageItems, authenticated, notificationsEnabled, permissionGranted, activeChatId, chatItems])

  function toggleNotifications() {
    setNotificationsEnabled((current) => !current)
  }

  return {
    notificationsEnabled,
    setNotificationsEnabled,
    toggleNotifications,
    permissionGranted
  }
}
