import { useState, useEffect, useRef, useEffectEvent } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type { ChatSummary, ChatDeviceSession, ChatMessage, LinkMetadata, RecipientDevice } from '../lib/api.ts'
import {
  createMessage,
  deleteMessage,
  fetchMediaLinkMetadata,
  listMessages,
  listRecipientDevices,
  toggleMessagePin,
  toggleMessageReaction,
  updateMessage
} from '../lib/api.ts'
import { readCachedMessages, writeCachedMessages, type CachedMessage } from '../lib/message-cache.ts'
import {
  countOutboxMessages,
  deleteOutboxMessage,
  listDueOutboxMessages,
  markOutboxRetry,
  queueOutboxMessage
} from '../lib/outbox-queue.ts'
import { encryptMessageWithSessions } from '../lib/chat-session-vault.ts'
import { encryptMessageWithGroupSenderKey, getActiveGroupSenderKey } from '../lib/message-vault.ts'
import { outboxRetryDelayMs } from '@vostok/crypto-core'
import { subscribeToChatStream } from '../lib/realtime.ts'
import { projectMessage } from '../utils/message-helpers.ts'
import { mergeMessageThread } from '../utils/message-helpers.ts'
import { syncChatSummary } from '../utils/chat-helpers.ts'
import { extractFirstHttpUrl } from '../utils/format.ts'
import { canUseChatSessions, shouldQueueOutboxSendFailure, isOutboxDuplicateClientIdError } from '../utils/crypto-helpers.ts'
import type { AuthView, AttachmentDescriptor } from '../types.ts'

export function useMessages(
  view: AuthView,
  deferredActiveChatId: string | null,
  activeChatIdRef: React.RefObject<string | null>,
  chatItems: ChatSummary[],
  setChatItems: React.Dispatch<React.SetStateAction<ChatSummary[]>>,
  syncChatSessionsFromServer: (
    chatId: string,
    knownRecipientDevices?: RecipientDevice[]
  ) => Promise<ChatDeviceSession[]>,
  chatSessions: ChatDeviceSession[]
) {
  const { storedDevice, loading, setLoading, setBanner } = useAppContext()
  const [messageItems, setMessageItems] = useState<CachedMessage[]>([])
  const [draft, setDraft] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [replyTargetMessageId, setReplyTargetMessageId] = useState<string | null>(null)
  const [_outboxPendingCount, setOutboxPendingCount] = useState(0)
  const [linkMetadataByUrl, setLinkMetadataByUrl] = useState<Record<string, LinkMetadata>>({})

  const messageItemsRef = useRef<CachedMessage[]>([])
  const linkMetadataInFlightRef = useRef(new Set<string>())

  useEffect(() => {
    messageItemsRef.current = messageItems
  }, [messageItems])

  function replaceActiveMessages(chatId: string, nextMessages: CachedMessage[], syncSummary: boolean) {
    if (activeChatIdRef.current !== chatId) {
      return
    }

    messageItemsRef.current = nextMessages
    setMessageItems(nextMessages)
    void writeCachedMessages(chatId, nextMessages)

    if (syncSummary) {
      setChatItems((current) => syncChatSummary(current, chatId, nextMessages))
    }
  }

  async function ingestMessageIntoActiveThread(message: ChatMessage, chatId: string) {
    if (!storedDevice || activeChatIdRef.current !== chatId) {
      return
    }

    const projected = await projectMessage(
      message,
      storedDevice.deviceId,
      storedDevice.encryptionPrivateKeyPkcs8Base64
    )

    if (activeChatIdRef.current !== chatId) {
      return
    }

    replaceActiveMessages(chatId, mergeMessageThread(messageItemsRef.current, projected), true)
  }

  async function syncMessagesFromServerNow(chatId: string) {
    if (!storedDevice || activeChatIdRef.current !== chatId) {
      return
    }

    await syncChatSessionsFromServer(chatId)

    const response = await listMessages(storedDevice.sessionToken, chatId)
    const projected = await Promise.all(
      response.messages.map((message) =>
        projectMessage(
          message,
          storedDevice.deviceId,
          storedDevice.encryptionPrivateKeyPkcs8Base64
        )
      )
    )

    if (activeChatIdRef.current !== chatId) {
      return
    }

    replaceActiveMessages(chatId, projected, true)
  }

  const syncMessagesFromServer = useEffectEvent(async (chatId: string) => {
    await syncMessagesFromServerNow(chatId)
  })

  const handleRealtimeMessage = useEffectEvent((_messageId: string, chatId: string) => {
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
    if (!storedDevice || !deferredActiveChatId || view !== 'chat') {
      setChatSessions_noop()
      setEditingMessageId(null)
      setReplyTargetMessageId(null)
      return
    }

    const chatId = deferredActiveChatId
    let cancelled = false
    setEditingMessageId(null)
    setReplyTargetMessageId(null)

    async function loadMessages() {
      try {
        const cached = await readCachedMessages(chatId)

        if (cancelled) {
          return
        }

        if (cached.length > 0) {
          messageItemsRef.current = cached
          setMessageItems(cached)
        } else {
          messageItemsRef.current = []
          setMessageItems([])
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
  }, [deferredActiveChatId, storedDevice, view])

  // Clear link metadata on chat change
  useEffect(() => {
    linkMetadataInFlightRef.current.clear()
    setLinkMetadataByUrl({})
  }, [deferredActiveChatId])

  // Load link metadata
  useEffect(() => {
    if (!storedDevice || view !== 'chat') {
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

    const sessionToken = storedDevice.sessionToken

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
  }, [linkMetadataByUrl, messageItems, storedDevice, view])

  // Subscribe to realtime chat stream
  useEffect(() => {
    if (!storedDevice || !deferredActiveChatId || view !== 'chat') {
      return
    }

    const chatId = deferredActiveChatId

    return subscribeToChatStream(storedDevice.sessionToken, chatId, {
      onMessage(messageId) {
        handleRealtimeMessage(messageId, chatId)
      },
      onError: handleRealtimeSubscriptionError
    })
  }, [deferredActiveChatId, storedDevice, view])

  // Build encrypted message payload
  async function buildEncryptedMessagePayload(
    plainText: string,
    chatId: string,
    clientId: string,
    messageKind: 'text' | 'attachment',
    replyToMessageId?: string | null
  ) {
    if (!storedDevice) {
      throw new Error('No local device identity is available.')
    }

    const targetChat = chatItems.find((chat) => chat.id === chatId) ?? null

    if (targetChat?.type === 'group') {
      const activeSenderKey = getActiveGroupSenderKey(chatId)

      if (!activeSenderKey) {
        throw new Error(
          'No active Sender Key is available for this group chat. Rotate a Sender Key before sending.'
        )
      }

      const payload = {
        client_id: clientId,
        message_kind: messageKind,
        ...(await encryptMessageWithGroupSenderKey(
          plainText,
          chatId,
          activeSenderKey.key_id,
          activeSenderKey.epoch
        ))
      }

      return {
        payload: replyToMessageId ? { ...payload, reply_to_message_id: replyToMessageId } : payload,
        deliveryMode: 'group_sender_key'
      } as const
    }

    const recipientDeviceResponse = await listRecipientDevices(storedDevice.sessionToken, chatId)
    const recipientDevices = recipientDeviceResponse.recipient_devices
    const sessions = await syncChatSessionsFromServer(chatId, recipientDevices)
    const canUseSessionEncryption = canUseChatSessions(storedDevice, sessions, recipientDevices)

    if (!canUseSessionEncryption) {
      throw new Error(
        'Session transport is required for this chat. Rotate prekeys or rekey active sessions and try again.'
      )
    }

    const payload = {
      client_id: clientId,
      message_kind: messageKind,
      ...(await encryptMessageWithSessions(plainText, storedDevice.deviceId, sessions))
    }

    return {
      payload: replyToMessageId ? { ...payload, reply_to_message_id: replyToMessageId } : payload,
      deliveryMode: 'session'
    } as const
  }

  async function queueMessageForOutbox(
    chatId: string,
    payload: {
      client_id: string
      ciphertext: string
      message_kind: string
      header?: string
      crypto_scheme?: string
      sender_key_id?: string
      sender_key_epoch?: number
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
    if (!storedDevice) {
      setOutboxPendingCount(0)
      return
    }

    const dueMessages = await listDueOutboxMessages(8)

    for (const queued of dueMessages) {
      try {
        const response = await createMessage(storedDevice.sessionToken, queued.chatId, queued.payload)
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
  }, [storedDevice?.deviceId, storedDevice?.sessionToken])

  const editingTargetMessage =
    editingMessageId
      ? messageItems.find((message) => message.id === editingMessageId) ?? null
      : null
  const replyTargetMessage =
    replyTargetMessageId
      ? messageItems.find((message) => message.id === replyTargetMessageId) ?? null
      : null

  async function sendDraftMessage(activeChatId: string | null) {
    if (!storedDevice || !activeChatId || draft.trim() === '') {
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
          storedDevice.sessionToken,
          activeChatId,
          activeEditingMessageId,
          payload
        )

        await ingestMessageIntoActiveThread(response.message, activeChatId)
        setBanner({
          tone: 'success',
          message:
            deliveryMode === 'group_sender_key'
              ? 'Message edited with Sender Key group encryption.'
              : 'Message edited with session encryption.'
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
      decryptable: true
    }

    replaceActiveMessages(activeChatId, mergeMessageThread(messageItemsRef.current, optimisticMessage), true)
    setDraft('')
    setReplyTargetMessageId(null)

    try {
      const { payload, deliveryMode } = await buildEncryptedMessagePayload(
        plainText,
        activeChatId,
        clientId,
        'text',
        activeReplyToMessageId
      )

      try {
        const response = await createMessage(storedDevice.sessionToken, activeChatId, payload)

        await ingestMessageIntoActiveThread(response.message, activeChatId)
        setBanner({
          tone: 'success',
          message:
            deliveryMode === 'group_sender_key'
              ? 'Sender Key encrypted message delivered to the server.'
              : 'Session-bootstrapped encrypted envelope delivered to the server.'
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
    if (!storedDevice || !activeChatId || message.side !== 'outgoing' || message.deletedAt) {
      return
    }

    setLoading(true)

    try {
      const response = await deleteMessage(storedDevice.sessionToken, activeChatId, message.id)
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

  async function handleToggleMessagePin(message: CachedMessage, activeChatId: string | null) {
    if (
      !storedDevice ||
      !activeChatId ||
      message.side === 'system' ||
      message.deletedAt ||
      message.id.startsWith('optimistic-')
    ) {
      return
    }

    setLoading(true)

    try {
      const response = await toggleMessagePin(storedDevice.sessionToken, activeChatId, message.id)
      await syncMessagesFromServerNow(activeChatId)
      setBanner({
        tone: 'success',
        message: response.message.pinned_at
          ? 'Pinned message updated for this chat.'
          : 'Pinned message cleared.'
      })
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to update the pinned message.'
      setBanner({ tone: 'error', message: messageText })
    } finally {
      setLoading(false)
    }
  }

  async function _handleQuickReaction(reactionKey: string, activeChatId: string | null) {
    if (!storedDevice || !activeChatId) {
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
        storedDevice.sessionToken,
        activeChatId,
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
    if (!storedDevice || !activeChatId) return
    try {
      const response = await toggleMessageReaction(storedDevice.sessionToken, activeChatId, messageId, reactionKey)
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
    queueMessageForOutbox
  }
}
