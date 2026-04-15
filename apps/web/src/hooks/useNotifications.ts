import { useEffect, useRef, useState } from 'react'
import type { CachedMessage } from '../lib/message-cache.ts'
import type { MergedChatSummary } from '../lib/multi-server.ts'
import type { UserSettings } from './useSettings.ts'
import {
  requestNotificationPermission,
  sendNotification,
  isWindowFocused
} from '../lib/notifications.ts'
import { getChannelCommentsNotify } from '../lib/channel-prefs.ts'

// ── Notification sound ──────────────────────────────────────────────────

let notifAudioCtx: AudioContext | null = null

function playNotificationSound() {
  try {
    if (!notifAudioCtx) notifAudioCtx = new AudioContext()
    const osc = notifAudioCtx.createOscillator()
    const gain = notifAudioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, notifAudioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, notifAudioCtx.currentTime + 0.3)
    osc.connect(gain).connect(notifAudioCtx.destination)
    osc.start()
    osc.stop(notifAudioCtx.currentTime + 0.3)
  } catch {
    // Audio not available — no-op
  }
}

// ── Hook ────────────────────────────────────────────────────────────────

export function useNotifications(
  authenticated: boolean,
  messageItems: CachedMessage[],
  chatItems: MergedChatSummary[],
  activeChatId: string | null,
  settings?: UserSettings
) {
  const [permissionGranted, setPermissionGranted] = useState(false)
  const previousMessageIdsRef = useRef<Set<string>>(new Set())
  const initialLoadRef = useRef(true)
  const desktopNotificationsEnabled = settings?.notif_desktop !== false

  // Request notification permission once authenticated (if desktop notifications enabled)
  useEffect(() => {
    if (!authenticated) return
    if (!desktopNotificationsEnabled) return

    void requestNotificationPermission().then((granted) => {
      setPermissionGranted(granted)
    })
  }, [authenticated, desktopNotificationsEnabled])

  // Reset tracked message IDs when the active chat changes
  useEffect(() => {
    previousMessageIdsRef.current = new Set()
    initialLoadRef.current = true
  }, [activeChatId])

  // Update document title with unread badge count
  useEffect(() => {
    if (!settings?.notif_badge) {
      // Restore clean title
      document.title = 'Vostok'
      return
    }

    const totalUnread = chatItems.reduce((sum, c) => sum + (c.message_count ?? 0), 0)
    document.title = totalUnread > 0 ? `(${totalUnread}) Vostok` : 'Vostok'
  }, [chatItems, settings?.notif_badge])

  // Watch for new incoming messages and send notifications
  useEffect(() => {
    if (!authenticated || !permissionGranted || !activeChatId) return
    if (!desktopNotificationsEnabled) return

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
    const hasMultipleServers = new Set(chatItems.map((chat) => chat.serverId)).size > 1

    // Don't notify for self-chats (Saved Messages)
    if (activeChat?.is_self_chat) {
      previousMessageIdsRef.current = currentIds
      return
    }

    // Don't notify if the window is focused — the user can already see the messages
    if (isWindowFocused()) {
      previousMessageIdsRef.current = currentIds
      return
    }

    // Check master notification toggle
    if (settings && !settings.notif_desktop) {
      previousMessageIdsRef.current = currentIds
      return
    }

    // In channels, comments (replies) are opt-in. Skip unless the viewer enabled them.
    const suppressChannelComments =
      activeChat?.type === 'channel' && !getChannelCommentsNotify(activeChatId)

    // Find new incoming messages that weren't in the previous set
    const newIncomingMessages = messageItems.filter(
      (m) =>
        !previousIds.has(m.id) &&
        m.side === 'incoming' &&
        !m.id.startsWith('optimistic-') &&
        !m.deletedAt &&
        !(suppressChannelComments && m.replyToMessageId)
    )

    for (const message of newIncomingMessages) {
      const chatTitle = activeChat?.title ?? 'Chat'
      const notificationTitle =
        hasMultipleServers && activeChat?.serverLabel
          ? `${activeChat.serverLabel} · ${chatTitle}`
          : chatTitle

      const showPreview = !settings || settings.notif_preview
      const body = showPreview && message.decryptable ? message.text : 'New message'

      void sendNotification({ title: notificationTitle, body, chatId: activeChatId })

      // Play notification sound if enabled
      if (!settings || settings.notif_sound) {
        playNotificationSound()
      }
    }

    previousMessageIdsRef.current = currentIds
  }, [activeChatId, authenticated, chatItems, desktopNotificationsEnabled, messageItems, permissionGranted, settings])

  return { permissionGranted }
}
