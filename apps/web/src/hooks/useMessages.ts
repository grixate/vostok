import { useState, useEffect, useRef, useEffectEvent } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import { SETTINGS_STORAGE_KEY } from '../constants.ts'
import type { ChatDeviceSession, ChatMessage, LinkMetadata, RecipientDevice } from '../lib/api.ts'
import {
  createMessage,
  deleteMessage,
  fetchMediaLinkMetadata,
  fetchUserPrekeys,
  listMessages,
  listRecipientDevices,
  markChatRead,
  toggleMessagePin,
  toggleMessageReaction,
  updateMessage
} from '../lib/api.ts'
import { readCachedMessages, writeCachedMessages, writeChatPreview, type CachedMessage } from '../lib/message-cache.ts'
import {
  countOutboxMessages,
  deleteOutboxMessage,
  listDueOutboxMessages,
  markOutboxRetry,
  queueOutboxMessage
} from '../lib/outbox-queue.ts'
import {
  encryptMessage as signalEncryptMessage,
  hasSession,
  buildSession,
  type SignalContext,
  type VostokPrekeyBundle
} from '../lib/signal-bridge.ts'
import { outboxRetryDelayMs } from '@vostok/crypto-core'
import { subscribeToChatStream, subscribeToReconnect } from '../lib/realtime.ts'
import {
  getRawChatId,
  getServerIdFromQualifiedChatId,
  type MergedChatSummary
} from '../lib/multi-server.ts'
import { projectMessage, cacheSentPlaintext, seedDecryptedCacheFromPersisted } from '../utils/message-helpers.ts'
import { mergeMessageThread, mergeSyncedMessageThread } from '../utils/message-helpers.ts'
import { syncChatSummary, compareMessageOrder } from '../utils/chat-helpers.ts'
import { extractFirstHttpUrl } from '../utils/format.ts'
import { shouldQueueOutboxSendFailure, isOutboxDuplicateClientIdError } from '../utils/crypto-helpers.ts'
import type { AuthView } from '../types.ts'

const chatProjectionQueues = new Map<string, Promise<void>>()

function runExclusiveChatProjection<T>(chatId: string, task: () => Promise<T>): Promise<T> {
  const previous = chatProjectionQueues.get(chatId) ?? Promise.resolve()
  let releaseCurrent!: () => void
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  const nextQueue = previous.catch(() => undefined).then(() => current)
  chatProjectionQueues.set(chatId, nextQueue)

  return previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      releaseCurrent()

      if (chatProjectionQueues.get(chatId) === nextQueue) {
        chatProjectionQueues.delete(chatId)
      }
    })
}

export function useMessages(
  view: AuthView,
  deferredActiveChatId: string | null,
  activeChatIdRef: React.RefObject<string | null>,
  chatItems: MergedChatSummary[],
  setChatItems: React.Dispatch<React.SetStateAction<MergedChatSummary[]>>,
  syncChatSessionsFromServer: (
    chatId: string,
    knownRecipientDevices?: RecipientDevice[]
  ) => Promise<ChatDeviceSession[]>,
  chatSessions: ChatDeviceSession[],
  currentUsername?: string | null
) {
  type MessageDeliveryMode = 'session'
  const { sessionToken, storedDevice, setLoading, setBanner } = useAppContext()
  // Use the device ID as a stable dependency for the message-loading effect.
  // The full storedDevice object changes when prekeys are consumed during
  // session sync, which would cause unnecessary effect re-runs that clear
  // messages.  The actual device data is accessed via useEffectEvent callbacks
  // that always see the latest values.
  const [messageItems, setMessageItems] = useState<CachedMessage[]>([])
  const [draft, setDraft] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [replyTargetMessageId, setReplyTargetMessageId] = useState<string | null>(null)
  const [, setOutboxPendingCount] = useState(0)
  const [linkMetadataByUrl, setLinkMetadataByUrl] = useState<Record<string, LinkMetadata>>({})
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const messageItemsRef = useRef<CachedMessage[]>([])
  const lastLoadedChatIdRef = useRef<string | null>(null)
  const memCacheRef = useRef(new Map<string, CachedMessage[]>())
  const linkMetadataInFlightRef = useRef(new Set<string>())
  const syncInFlightRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    messageItemsRef.current = messageItems
  }, [messageItems])

  // The Signal protocol store now lives entirely in the Rust side; there is
  // nothing to bootstrap on the web when `storedDevice` changes. The device
  // presence itself (`storedDevice?.deviceId`) is the gate for send/decrypt
  // paths — see the explicit check in the encrypt path below.

  function formatPreviewText(msg: CachedMessage): string {
    const t = msg.text
    if (t.startsWith('Voice note:')) return 'Voice message'
    if (t.startsWith('Round video:')) return 'Video message'
    if (t.startsWith('Attachment:')) return 'Photo'
    return t
  }

  function replaceActiveMessages(chatId: string, nextMessages: CachedMessage[], syncSummary: boolean) {
    if (activeChatIdRef.current !== chatId) {
      return
    }

    messageItemsRef.current = nextMessages
    setMessageItems(nextMessages)
    memCacheRef.current.set(chatId, nextMessages)
    void writeCachedMessages(chatId, nextMessages)

    // Persist the last decrypted message preview for the sidebar chat list.
    const lastDecrypted = [...nextMessages].reverse().find(
      (m) => m.decryptable && m.text && m.side !== 'system' && !m.deletedAt
    )
    writeChatPreview(chatId, lastDecrypted ? formatPreviewText(lastDecrypted) : '')

    if (syncSummary) {
      setChatItems((current) => syncChatSummary(current, chatId, nextMessages))
    }
  }

  function preserveExistingDecryptedProjection(
    existingMessages: CachedMessage[],
    projected: CachedMessage
  ): CachedMessage {
    if (projected.decryptable) {
      return projected
    }

    const existing = existingMessages.find(
      (message) =>
        message.id === projected.id ||
        (!!projected.clientId && !!message.clientId && message.clientId === projected.clientId)
    )

    if (!existing || !existing.decryptable || !existing.text) {
      return projected
    }

    return {
      ...projected,
      text: existing.text,
      decryptable: true,
      attachment: existing.attachment
    }
  }

  async function ingestMessageIntoActiveThread(message: ChatMessage, chatId: string) {
    if (activeChatIdRef.current !== chatId) {
      return
    }

    const projected = preserveExistingDecryptedProjection(
      messageItemsRef.current,
      await runExclusiveChatProjection(chatId, async () =>
        projectMessage(
          message,
          chatId,
          storedDevice?.deviceId ?? '',
          undefined,
          currentUsername ?? undefined
        )
      )
    )

    if (activeChatIdRef.current !== chatId) {
      return
    }

    replaceActiveMessages(chatId, mergeMessageThread(messageItemsRef.current, projected), true)
  }

  async function syncMessagesFromServerNow(chatId: string) {
    const rawChatId = getRawChatId(chatId)

    if (!rawChatId) {
      return
    }

    // Serialise sync calls — the decrypt path reads and writes shared ratchet
    // state in localStorage, so concurrent syncs corrupt session counters.
    if (syncInFlightRef.current) {
      await syncInFlightRef.current.catch(() => {})
    }

    const threadAtSyncStart = [...messageItemsRef.current]

    const run = async () => runExclusiveChatProjection(chatId, async () => {
      if (!sessionToken || activeChatIdRef.current !== chatId || !storedDevice?.deviceId) {
        return
      }

      // Session bootstrap can fail for various reasons (self-chat with no peers,
      // network issues, etc.) — don't let it block message loading.
      if (storedDevice) {
        try {
          await syncChatSessionsFromServer(chatId)
        } catch (sessionError) {
          console.warn('Session sync failed, loading messages anyway:', sessionError)
        }
      }

      const response = await listMessages(sessionToken, rawChatId)
      // Messages MUST be projected sequentially — each decryption reads and
      // writes the shared ratchet state (receive counter, skipped message keys,
      // etc.) in localStorage.  Parallel decryption via Promise.all causes race
      // conditions where one message's state write overwrites another's.
      const projected: Awaited<ReturnType<typeof projectMessage>>[] = []

      const deviceId = storedDevice?.deviceId ?? ''
      const encryptionKey = undefined

      for (const message of response.messages) {
        projected.push(
          preserveExistingDecryptedProjection(
            [...messageItemsRef.current, ...projected],
            await projectMessage(
              message,
              chatId,
              deviceId,
              encryptionKey,
              currentUsername ?? undefined
            )
          )
        )
      }

      if (activeChatIdRef.current !== chatId) {
        return
      }

      setHasMoreMessages(response.has_more)

      // Preserve any optimistic (not-yet-confirmed) outgoing messages so the
      // user doesn't see their pending message disappear while the server sync
      // round-trips.  Once ingestMessageIntoActiveThread replaces the
      // optimistic entry with the server-confirmed version, it drops out of
      // future sync passes automatically.
      const merged = mergeSyncedMessageThread(
        threadAtSyncStart,
        messageItemsRef.current,
        projected
      )

      replaceActiveMessages(chatId, merged, true)

      // Mark the chat as read now that messages are visible.  Fire-and-forget
      // so it doesn't block the UI.  The last message ID lets the server track
      // the exact read cursor for unread-count computation.
      const lastMessageId = projected.length > 0
        ? projected[projected.length - 1].id
        : undefined
      const validLastId = lastMessageId && !lastMessageId.startsWith('optimistic-')
        ? lastMessageId
        : undefined
      // Respect privacy_read_receipts setting
      const settingsRaw = localStorage.getItem(SETTINGS_STORAGE_KEY)
      const readReceiptsEnabled = settingsRaw ? (JSON.parse(settingsRaw) as { privacy_read_receipts?: boolean }).privacy_read_receipts !== false : true
      if (readReceiptsEnabled) {
        void markChatRead(sessionToken, rawChatId, validLastId).catch(() => {})
      }
    })

    const promise = run()
    syncInFlightRef.current = promise
    try {
      await promise
    } finally {
      if (syncInFlightRef.current === promise) {
        syncInFlightRef.current = null
      }
    }
  }

  const syncMessagesFromServer = useEffectEvent(async (chatId: string) => {
    await syncMessagesFromServerNow(chatId)
  })

  const deferredSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleRealtimeMessage = useEffectEvent((messageId: string, chatId: string) => {
    const thread = messageItemsRef.current
    // Do not short-circuit when a message id is already present locally.
    // Realtime activity for edits/reactions/pins reuses the same message id,
    // and we must re-sync to pick up updated ciphertext/metadata.

    // If we have a recent pending optimistic outgoing message, the realtime
    // event is most likely the server echo of our own just-sent message.  The
    // async ingestMessageIntoActiveThread flow hasn't finished replacing the
    // optimistic entry yet, so a full re-sync right now would cause a visual
    // flicker.  Skip the immediate sync but schedule a deferred one as a
    // safety net — if ingestion fails or the optimistic message isn't replaced
    // within a few seconds, the deferred sync will pick up the server version.
    const OPTIMISTIC_GRACE_MS = 60_000
    const now = Date.now()
    const hasRecentOptimistic = thread.some((m) => {
      if (!m.id.startsWith('optimistic-') || m.side !== 'outgoing') return false
      const sentAt = m.sentAt ? new Date(m.sentAt).getTime() : 0
      return (now - sentAt) < OPTIMISTIC_GRACE_MS
    })
    if (hasRecentOptimistic) {
      // Schedule a deferred sync to catch attachment messages where ingestion
      // takes longer or fails silently (voice notes, round videos, file uploads).
      if (deferredSyncTimerRef.current) {
        clearTimeout(deferredSyncTimerRef.current)
      }
      deferredSyncTimerRef.current = setTimeout(() => {
        deferredSyncTimerRef.current = null
        // Only sync if optimistic messages are still present — if ingestion
        // already replaced them, no sync is needed.
        const current = messageItemsRef.current
        if (current.some((m) => m.id.startsWith('optimistic-'))) {
          void syncMessagesFromServer(chatId)
        }
      }, 3_000)
      return
    }

    void syncMessagesFromServer(chatId)
  })

  const handleRealtimeSubscriptionError = useEffectEvent(() => {
    setBanner({
      tone: 'error',
      message: 'Realtime chat subscription failed. HTTP sync is still available.'
    })
  })

  // Load messages on chat change
  useEffect(() => {
    if (!sessionToken || !deferredActiveChatId || view !== 'chat' || !storedDevice?.deviceId) {
      setChatSessions_noop()
      setEditingMessageId(null)
      setReplyTargetMessageId(null)
      return
    }

    const chatId = deferredActiveChatId
    let cancelled = false
    setEditingMessageId(null)
    setReplyTargetMessageId(null)

    // Cancel any pending deferred sync from the previous chat.
    if (deferredSyncTimerRef.current) {
      clearTimeout(deferredSyncTimerRef.current)
      deferredSyncTimerRef.current = null
    }

    // Only clear messages when switching to a different chat.  When the
    // effect re-fires because sessionToken refreshed (same chat), keep the
    // existing messages visible so the user doesn't see a flash of empty
    // content while the server re-syncs.
    const chatChanged = lastLoadedChatIdRef.current !== chatId
    if (chatChanged) {
      // Save outgoing chat's messages to in-memory cache
      const prevChatId = lastLoadedChatIdRef.current
      if (prevChatId && messageItemsRef.current.length > 0) {
        memCacheRef.current.set(prevChatId, messageItemsRef.current)
        // Keep cache bounded to last 20 chats
        if (memCacheRef.current.size > 20) {
          const oldest = memCacheRef.current.keys().next().value!
          memCacheRef.current.delete(oldest)
        }
      }

      // Instantly restore from memory cache if available
      const memCached = memCacheRef.current.get(chatId)
      if (memCached) {
        messageItemsRef.current = memCached
        setMessageItems(memCached)
      } else {
        messageItemsRef.current = []
        setMessageItems([])
      }
      setHasMoreMessages(false)
    }
    lastLoadedChatIdRef.current = chatId

    async function loadMessages() {
      try {
        // Skip cache read if we already have messages for this chat
        // (e.g. token refresh re-triggered the effect).
        if (messageItemsRef.current.length === 0) {
          const cached = await readCachedMessages(chatId)

          if (cancelled) {
            return
          }

          if (cached.length > 0) {
            seedDecryptedCacheFromPersisted(chatId, cached)
            messageItemsRef.current = cached
            setMessageItems(cached)
          }
        } else {
          // Messages already visible — just seed the decryption cache.
          seedDecryptedCacheFromPersisted(chatId, messageItemsRef.current)
        }

        await syncMessagesFromServer(chatId)
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load messages.'
          setBanner({ tone: 'error', message })
        }
      }
    }

    void loadMessages()

    return () => {
      cancelled = true
    }
  }, [deferredActiveChatId, sessionToken, setBanner, storedDevice?.deviceId, view])

  // Clear link metadata on chat change
  useEffect(() => {
    linkMetadataInFlightRef.current.clear()
    setLinkMetadataByUrl({})
  }, [deferredActiveChatId])

  // Load link metadata
  useEffect(() => {
    if (!sessionToken || view !== 'chat') {
      return
    }

    const uniqueUrls = Array.from(
      new Set(
        messageItems
          .map((message) => extractFirstHttpUrl(message.text))
          .filter((url): url is string => Boolean(url))
      )
    )

    if (uniqueUrls.length === 0) {
      return
    }

    for (const url of uniqueUrls) {
      if (linkMetadataByUrl[url] || linkMetadataInFlightRef.current.has(url)) {
        continue
      }

      linkMetadataInFlightRef.current.add(url)

      void fetchMediaLinkMetadata(sessionToken, url)
        .then((response) => {
          setLinkMetadataByUrl((current) =>
            current[url] ? current : { ...current, [url]: response.metadata }
          )
        })
        .catch(() => undefined)
        .finally(() => {
          linkMetadataInFlightRef.current.delete(url)
        })
    }
  }, [linkMetadataByUrl, messageItems, sessionToken, view])

  // Subscribe to realtime chat stream
  useEffect(() => {
    if (!sessionToken || !deferredActiveChatId || view !== 'chat') {
      return
    }

    const chatId = deferredActiveChatId
    const rawChatId = getRawChatId(chatId)

    if (!rawChatId) {
      return
    }

    return subscribeToChatStream(sessionToken, rawChatId, {
      onMessage(messageId) {
        handleRealtimeMessage(messageId, chatId)
      },
      onError: handleRealtimeSubscriptionError
    })
  }, [deferredActiveChatId, sessionToken, view])

  // Resync after connection recovery — catch up on messages missed during disconnect
  useEffect(() => {
    if (!sessionToken || !deferredActiveChatId || view !== 'chat') return

    const chatId = deferredActiveChatId

    return subscribeToReconnect(() => {
      void syncMessagesFromServer(chatId)
    })
  }, [deferredActiveChatId, sessionToken, view])

  // Build encrypted message payload using Signal protocol
  async function buildEncryptedMessagePayload(
    plainText: string,
    chatId: string,
    clientId: string,
    messageKind: 'text' | 'attachment',
    replyToMessageId?: string | null
  ): Promise<{
    payload: {
      client_id: string
      ciphertext: string
      message_kind: 'text' | 'attachment'
      header?: string
      crypto_scheme?: string
      reply_to_message_id?: string
      recipient_envelopes?: Record<string, string>
      established_session_ids?: string[]
    }
    deliveryMode: MessageDeliveryMode
  }> {
    const device = storedDevice
    if (!device) {
      throw new Error(
        'Encryption keys are not yet available. Setting up your device\u2026'
      )
    }

    if (!sessionToken) {
      throw new Error('No session token is available.')
    }

    const rawChatId = getRawChatId(chatId)
    if (!rawChatId) {
      throw new Error('The selected chat is unavailable.')
    }

    const chatServerId = getServerIdFromQualifiedChatId(chatId)
    if (!chatServerId) {
      throw new Error('Cannot resolve server for chat encryption.')
    }
    const signalCtx: SignalContext = {
      serverId: chatServerId,
      localDeviceId: device.deviceId
    }

    // Get all recipient devices for this chat
    const recipientDeviceResponse = await listRecipientDevices(sessionToken, rawChatId)
    const recipientDevices = recipientDeviceResponse.recipient_devices

    // Build Signal sessions for devices that don't have one yet.
    // The Rust-backed `hasSession` currently short-circuits to false, so we
    // unconditionally try to build a session for every non-self device.
    // `buildSession` is idempotent.
    const devicesNeedingSession: string[] = []
    for (const rd of recipientDevices) {
      if (rd.device_id === device.deviceId) continue
      if (!(await hasSession(signalCtx, rd.device_id))) {
        devicesNeedingSession.push(rd.device_id)
      }
    }

    // Fetch prekey bundles for devices without sessions
    const prekeyBundlesByDeviceId = new Map<string, VostokPrekeyBundle>()
    if (devicesNeedingSession.length > 0) {
      // Map user_id → username from the chat summary's parallel arrays
      const targetChat = chatItems.find((chat) => chat.id === chatId) ?? null
      const userIdToUsername = new Map<string, string>()
      if (targetChat) {
        for (let i = 0; i < targetChat.participant_user_ids.length; i++) {
          userIdToUsername.set(targetChat.participant_user_ids[i], targetChat.participant_usernames[i])
        }
      }

      // Group devices by username to minimize API calls
      const usernameDeviceMap = new Map<string, string[]>()
      for (const rd of recipientDevices) {
        if (devicesNeedingSession.includes(rd.device_id)) {
          // Resolve username from chat participants, fall back to current user's
          // username for self-chats where participant arrays may be sparse
          const username = userIdToUsername.get(rd.user_id) ?? device.username
          const existing = usernameDeviceMap.get(username) ?? []
          existing.push(rd.device_id)
          usernameDeviceMap.set(username, existing)
        }
      }

      for (const [username, deviceIds] of usernameDeviceMap) {
        try {
          const response = await fetchUserPrekeys(sessionToken, username)
          for (const bundle of response.devices) {
            if (
              deviceIds.includes(bundle.device_id) &&
              bundle.signed_prekey &&
              bundle.signed_prekey_signature &&
              bundle.registration_id != null &&
              bundle.signed_prekey_id != null &&
              bundle.kyber_prekey_id != null &&
              bundle.kyber_prekey &&
              bundle.kyber_prekey_signature
            ) {
              prekeyBundlesByDeviceId.set(bundle.device_id, {
                device_id: bundle.device_id,
                identity_public_key: bundle.identity_public_key,
                registration_id: bundle.registration_id,
                signed_prekey_id: bundle.signed_prekey_id,
                signed_prekey_public: bundle.signed_prekey,
                signed_prekey_signature: bundle.signed_prekey_signature,
                one_time_prekey_id: bundle.one_time_prekey_id ?? undefined,
                one_time_prekey_public: bundle.one_time_prekey ?? undefined,
                kyber_prekey_id: bundle.kyber_prekey_id,
                kyber_prekey_public: bundle.kyber_prekey,
                kyber_prekey_signature: bundle.kyber_prekey_signature
              })
            }
          }
        } catch (error) {
          console.warn(`[useMessages] Failed to fetch prekeys for user ${username}:`, error)
        }
      }
    }

    // Encrypt for all recipient devices using Signal sessions
    const signalRecipients = recipientDevices.map((rd) => ({
      deviceId: rd.device_id,
      prekeyBundle: prekeyBundlesByDeviceId.get(rd.device_id)
    }))

    const envelope = await signalEncryptMessage(signalCtx, signalRecipients, plainText)

    const payload = {
      client_id: clientId,
      message_kind: messageKind,
      ...envelope
    }

    return {
      payload: replyToMessageId ? { ...payload, reply_to_message_id: replyToMessageId } : payload,
      deliveryMode: 'session'
    }
  }

  async function queueMessageForOutbox(
    chatId: string,
    payload: {
      client_id: string
      ciphertext: string
      message_kind: string
      header?: string
      crypto_scheme?: string
      reply_to_message_id?: string
      recipient_envelopes?: Record<string, string>
      established_session_ids?: string[]
    },
    lastError: string
  ) {
    await queueOutboxMessage({
      id: payload.client_id,
      chatId,
      payload,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      nextAttemptAt: Date.now(),
      lastError
    })
    setOutboxPendingCount(await countOutboxMessages())
  }

  const replayOutboxMessages = useEffectEvent(async () => {
    if (!sessionToken || !storedDevice) {
      setOutboxPendingCount(0)
      return
    }

    const dueMessages = await listDueOutboxMessages(8)

    for (const queued of dueMessages) {
      try {
        const rawChatId = getRawChatId(queued.chatId)

        if (!rawChatId) {
          await deleteOutboxMessage(queued.id)
          continue
        }

        const response = await createMessage(sessionToken, rawChatId, queued.payload)
        await ingestMessageIntoActiveThread(response.message, queued.chatId)
        await deleteOutboxMessage(queued.id)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to replay queued outbound message.'

        if (isOutboxDuplicateClientIdError(message)) {
          await deleteOutboxMessage(queued.id)
          continue
        }

        const nextAttemptCount = queued.attemptCount + 1
        await markOutboxRetry(
          queued.id,
          nextAttemptCount,
          outboxRetryDelayMs(nextAttemptCount),
          message
        )
      }
    }

    setOutboxPendingCount(await countOutboxMessages())
  })

  // Outbox replay timer
  useEffect(() => {
    let cancelled = false

    async function tickOutbox() {
      if (cancelled) {
        return
      }

      try {
        await replayOutboxMessages()
      } catch {
        // Ignore replay loop errors; next tick will retry.
      }
    }

    void tickOutbox()
    const timer = window.setInterval(() => {
      void tickOutbox()
    }, 8_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [storedDevice?.deviceId, sessionToken])

  const editingTargetMessage =
    editingMessageId
      ? messageItems.find((message) => message.id === editingMessageId) ?? null
      : null
  const replyTargetMessage =
    replyTargetMessageId
      ? messageItems.find((message) => message.id === replyTargetMessageId) ?? null
      : null

  async function sendDraftMessage(activeChatId: string | null) {
    const rawActiveChatId = getRawChatId(activeChatId)

    if (!sessionToken || !activeChatId || !rawActiveChatId || draft.trim() === '') {
      return
    }

    setLoading(true)

    const plainText = draft.trim()
    const activeReplyToMessageId = replyTargetMessageId
    const activeEditingMessageId = editingMessageId

    if (activeEditingMessageId && editingTargetMessage) {
      setDraft('')
      setEditingMessageId(null)
      setReplyTargetMessageId(null)

      try {
        const { payload, deliveryMode } = await buildEncryptedMessagePayload(
          plainText,
          activeChatId,
          editingTargetMessage.clientId ?? `edit-${activeEditingMessageId}`,
          editingTargetMessage.attachment ? 'attachment' : 'text',
          activeReplyToMessageId
        )

        const response = await updateMessage(
          sessionToken,
          rawActiveChatId,
          activeEditingMessageId,
          payload
        )

        cacheSentPlaintext(
          response.message.client_id,
          plainText,
          undefined,
          response.message.edited_at
        )
        await ingestMessageIntoActiveThread(response.message, activeChatId)
        setBanner({
          tone: 'success',
          message: 'Message edited.'
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to edit message.'
        setBanner({ tone: 'error', message })
        setDraft(plainText)
        setEditingMessageId(activeEditingMessageId)
        setReplyTargetMessageId(activeReplyToMessageId)
      } finally {
        setLoading(false)
      }

      return
    }

    const clientId = window.crypto.randomUUID()
    const optimisticId = `optimistic-${clientId}`
    const optimisticMessage: CachedMessage = {
      id: optimisticId,
      clientId,
      replyToMessageId: activeReplyToMessageId ?? undefined,
      text: plainText,
      sentAt: new Date().toISOString(),
      side: 'outgoing',
      senderId: storedDevice?.deviceId,
      senderUsername: currentUsername ?? undefined,
      decryptable: true
    }

    cacheSentPlaintext(clientId, plainText)
    replaceActiveMessages(activeChatId, mergeMessageThread(messageItemsRef.current, optimisticMessage), true)
    setDraft('')
    setReplyTargetMessageId(null)

    try {
      // Retry encryption setup — session bootstrap may need a moment to
      // establish keys with the recipient's device.
      const MAX_ENCRYPT_RETRIES = 4
      const RETRY_DELAY_MS = 1500
      let payload: Awaited<ReturnType<typeof buildEncryptedMessagePayload>>['payload'] | null = null
      let deliveryMode: string = ''
      let lastEncryptError: unknown = null

      for (let attempt = 0; attempt < MAX_ENCRYPT_RETRIES; attempt++) {
        try {
          const result = await buildEncryptedMessagePayload(
            plainText,
            activeChatId,
            clientId,
            'text',
            activeReplyToMessageId
          )
          payload = result.payload
          deliveryMode = result.deliveryMode
          break
        } catch (error) {
          lastEncryptError = error
          if (attempt < MAX_ENCRYPT_RETRIES - 1) {
            setBanner({ tone: 'info', message: 'Setting up encryption\u2026' })
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
          }
        }
      }

      if (!payload) {
        throw lastEncryptError ?? new Error('Failed to encrypt message.')
      }

      try {
        const response = await createMessage(sessionToken, rawActiveChatId, payload)

        await ingestMessageIntoActiveThread(response.message, activeChatId)
        setBanner({
          tone: 'success',
          message: 'Encrypted message delivered to the server.'
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send message.'

        if (shouldQueueOutboxSendFailure(message)) {
          await queueMessageForOutbox(activeChatId, payload, message)
          setBanner({
            tone: 'info',
            message: 'Message queued for offline replay. It will retry automatically.'
          })
          return
        }

        throw error
      }
    } catch (error) {
      console.error('[sendDraftMessage] FAILED:', error)
      const message = error instanceof Error ? error.message : 'Failed to send message.'
      setBanner({ tone: 'error', message })
      setDraft(plainText)
      setReplyTargetMessageId(activeReplyToMessageId)
      replaceActiveMessages(
        activeChatId,
        messageItemsRef.current.filter((item) => item.clientId !== clientId && item.id !== optimisticId),
        true
      )
    } finally {
      setLoading(false)
    }
  }

  function handleReplyToMessage(message: CachedMessage) {
    if (message.side === 'system' || message.deletedAt) {
      return
    }

    setEditingMessageId(null)
    setReplyTargetMessageId(message.id)
  }

  function handleStartEditingMessage(message: CachedMessage) {
    if (message.side !== 'outgoing' || message.attachment || message.deletedAt) {
      return
    }

    setEditingMessageId(message.id)
    setReplyTargetMessageId(message.replyToMessageId ?? null)
    setDraft(message.text)
  }

  async function handleDeleteExistingMessage(message: CachedMessage, activeChatId: string | null) {
    const rawActiveChatId = getRawChatId(activeChatId)

    if (!sessionToken || !activeChatId || !rawActiveChatId || message.side !== 'outgoing' || message.deletedAt) {
      return
    }

    setLoading(true)

    try {
      const response = await deleteMessage(sessionToken, rawActiveChatId, message.id)
      await ingestMessageIntoActiveThread(response.message, activeChatId)

      if (editingMessageId === message.id) {
        setEditingMessageId(null)
        setDraft('')
      }

      if (replyTargetMessageId === message.id) {
        setReplyTargetMessageId(null)
      }

      setBanner({ tone: 'success', message: 'Message deleted for this chat.' })
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to delete the message.'
      setBanner({ tone: 'error', message: messageText })
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleMessagePin(message: CachedMessage, activeChatId: string | null): Promise<{ pinned: boolean } | null> {
    const rawActiveChatId = getRawChatId(activeChatId)

    if (
      !sessionToken ||
      !activeChatId ||
      !rawActiveChatId ||
      message.side === 'system' ||
      message.deletedAt ||
      message.id.startsWith('optimistic-')
    ) {
      return null
    }

    setLoading(true)

    try {
      const response = await toggleMessagePin(sessionToken, rawActiveChatId, message.id)
      await syncMessagesFromServerNow(activeChatId)
      const pinned = !!response.message.pinned_at
      setBanner({
        tone: 'success',
        message: pinned
          ? 'Pinned message updated for this chat.'
          : 'Pinned message cleared.'
      })
      return { pinned }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to update the pinned message.'
      setBanner({ tone: 'error', message: messageText })
      throw error
    } finally {
      setLoading(false)
    }
  }

  async function _handleQuickReaction(reactionKey: string, activeChatId: string | null) {
    const rawActiveChatId = getRawChatId(activeChatId)

    if (!sessionToken || !activeChatId || !rawActiveChatId) {
      return
    }

    const targetMessage = [...messageItemsRef.current]
      .reverse()
      .find((message) => !message.id.startsWith('optimistic-') && !message.deletedAt)

    if (!targetMessage) {
      setBanner({ tone: 'info', message: 'Send a message before adding reactions.' })
      return
    }

    setLoading(true)

    try {
      const response = await toggleMessageReaction(
        sessionToken,
        rawActiveChatId,
        targetMessage.id,
        reactionKey
      )

      await ingestMessageIntoActiveThread(response.message, activeChatId)
      setBanner({ tone: 'success', message: `Reaction ${reactionKey} updated on the latest message.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update reaction.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleReaction(messageId: string, activeChatId: string | null, reactionKey: string) {
    const rawActiveChatId = getRawChatId(activeChatId)

    if (!sessionToken || !activeChatId || !rawActiveChatId) return
    try {
      const response = await toggleMessageReaction(sessionToken, rawActiveChatId, messageId, reactionKey)
      await ingestMessageIntoActiveThread(response.message, activeChatId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update reaction.'
      setBanner({ tone: 'error', message })
    }
  }

  // This is a no-op placeholder used where chat session clearing was needed in the original
  function setChatSessions_noop() {
    // Chat sessions are managed by useChatSessions hook
  }

  /**
   * Lightweight preview update for non-active chats.
   * Called when `chat:activity` fires for a chat that is already in the list
   * but is NOT the currently active chat.  Fetches the latest message, tries
   * to decrypt it, and writes the preview to localStorage so the sidebar
   * displays the actual message text instead of "Encrypted message".
   */
  async function updateNonActiveChatPreview(chatId: string) {
    const rawChatId = getRawChatId(chatId)

    if (!sessionToken || !storedDevice?.deviceId || activeChatIdRef.current === chatId) {
      return
    }

    if (!rawChatId) {
      return
    }

    try {
      // Bootstrap / discover sessions for the chat so we can decrypt.
      if (storedDevice) {
        await syncChatSessionsFromServer(chatId)
      }

      const response = await listMessages(sessionToken, rawChatId, { limit: 1 })

      if (response.messages.length === 0) {
        return
      }

      // Only decrypt the last message — enough for the sidebar preview.
      const lastServerMessage = response.messages[response.messages.length - 1]
      const projected = preserveExistingDecryptedProjection(
        messageItemsRef.current,
        await runExclusiveChatProjection(chatId, async () =>
          projectMessage(
            lastServerMessage,
            chatId,
            storedDevice?.deviceId ?? '',
            undefined,
            currentUsername ?? undefined
          )
        )
      )

      if (projected.decryptable && projected.text && projected.side !== 'system') {
        writeChatPreview(chatId, formatPreviewText(projected))

        // Bump chatItems so the sidebar re-renders with the new preview.
        // Pass false — this is a non-active chat, so preserve/increment unread count.
        setChatItems((current) => syncChatSummary(current, chatId, [projected], false))
      }
    } catch {
      // Preview update is best-effort — silently ignore failures.
    }
  }

  async function loadOlderMessages(chatId: string) {
    const rawChatId = getRawChatId(chatId)

    if (!sessionToken || !rawChatId || loadingOlder || !hasMoreMessages) {
      return
    }

    const currentMessages = messageItemsRef.current
    // Find the oldest real (non-optimistic) message as the cursor
    const oldestMessage = currentMessages.find((m) => !m.id.startsWith('optimistic-'))
    if (!oldestMessage) {
      return
    }

    setLoadingOlder(true)

    try {
      const response = await listMessages(sessionToken, rawChatId, {
        before: oldestMessage.id
      })

      if (activeChatIdRef.current !== chatId) {
        return
      }

      const deviceId = storedDevice?.deviceId ?? ''
      const encryptionKey = undefined

      const projected = await runExclusiveChatProjection(chatId, async () => {
        const nextProjected: Awaited<ReturnType<typeof projectMessage>>[] = []
        for (const message of response.messages) {
          nextProjected.push(
            preserveExistingDecryptedProjection(
              [...messageItemsRef.current, ...nextProjected],
              await projectMessage(
                message,
                chatId,
                deviceId,
                encryptionKey,
                currentUsername ?? undefined
              )
            )
          )
        }

        return nextProjected
      })

      if (activeChatIdRef.current !== chatId) {
        return
      }

      setHasMoreMessages(response.has_more)

      const merged = [...projected, ...messageItemsRef.current].sort(compareMessageOrder)
      replaceActiveMessages(chatId, merged, false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load older messages.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoadingOlder(false)
    }
  }

  return {
    messageItems,
    messageItemsRef,
    draft,
    setDraft,
    editingMessageId,
    setEditingMessageId,
    replyTargetMessageId,
    setReplyTargetMessageId,
    linkMetadataByUrl,
    editingTargetMessage,
    replyTargetMessage,
    hasMoreMessages,
    loadingOlder,
    loadOlderMessages,
    sendDraftMessage,
    handleReplyToMessage,
    handleStartEditingMessage,
    handleDeleteExistingMessage,
    handleToggleMessagePin,
    _handleQuickReaction,
    handleToggleReaction,
    buildEncryptedMessagePayload,
    replaceActiveMessages,
    ingestMessageIntoActiveThread,
    syncMessagesFromServerNow,
    queueMessageForOutbox,
    updateNonActiveChatPreview
  }
}
