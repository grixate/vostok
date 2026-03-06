/**
 * Conversation state hook — owns all per-chat message state, encryption
 * sessions, group state, safety numbers, attachment playback, voice/video
 * recording, and the outbox replay loop.
 *
 * Explicitly skipped (stay in App.tsx): calls/Membrane (19+ useState),
 * federation (5 useState), adminOverview, turnCredentials.
 */

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { outboxRetryDelayMs, sha256Hex } from '@vostok/crypto-core'
import {
  appendMediaUploadPart,
  bootstrapChatSessions,
  completeMediaUpload,
  createMediaUpload,
  createMessage,
  deleteMessage,
  distributeGroupSenderKeys,
  fetchMediaLinkMetadata,
  fetchMediaUpload,
  fetchMediaUploadState,
  fetchUserPrekeys,
  listGroupMembers,
  listGroupSenderKeys,
  listMessages,
  listRecipientDevices,
  listSafetyNumbers,
  rekeyChatSessions,
  removeGroupMember,
  renameGroupChat,
  toggleMessagePin,
  updateGroupMemberRole,
  updateMessage,
  verifySafetyNumber,
  type ChatDeviceSession,
  type ChatMessage,
  type ChatSummary,
  type GroupMember,
  type GroupSenderKey,
  type LinkMetadata,
  type PrekeyDeviceBundle,
} from '../../lib/api'
import { base64ToBytes, bytesToBase64 } from '../../lib/base64'
import {
  encryptMessageWithSessions,
  prepareSessionBootstrap,
  pruneConsumedOneTimePrekeys,
  synchronizeChatSessions,
} from '../../lib/chat-session-vault'
import {
  encryptMessageWithGroupSenderKey,
  getActiveGroupSenderKey,
  setActiveGroupSenderKey,
  storeGroupSenderKeyMaterial,
  storeInboundGroupSenderKeys,
  wrapGroupSenderKeyForRecipients,
} from '../../lib/message-vault'
import type { LocalSessionDeviceMaterial } from '../../lib/chat-session-vault'
import {
  decryptAttachmentFile,
  encryptAttachmentFile,
  generateAttachmentThumbnailDataUrl,
  generateAttachmentWaveform,
} from '../../lib/attachment-vault'
import {
  countOutboxMessages,
  deleteOutboxMessage,
  listDueOutboxMessages,
  markOutboxRetry,
  queueOutboxMessage,
} from '../../lib/outbox-queue'
import { readCachedMessages, writeCachedMessages, type CachedMessage } from '../../lib/message-cache'
import { subscribeToChatStream } from '../../lib/realtime'
import {
  inferMediaKind,
  isOutboxDuplicateClientIdError,
  mergeMessageThread,
  shouldQueueOutboxSendFailure,
  syncChatSummary,
  toSafetyNumberEntry,
} from '../lib/chat-utils'
import { canUseChatSessions, projectMessage, toLocalSessionDeviceMaterial } from '../lib/message-projection'
import { persistStoredDevice, type StoredDevice } from '../context/AuthContext'
import type { AuthView } from '../context/AuthContext'
import type { AttachmentDescriptor, Banner, SafetyNumberEntry } from '../types/chat'

// ── Public interface ──────────────────────────────────────────────────────────

export interface ConversationHookResult {
  // ── Message thread ─────────────────────────────────────────────────────────
  messageItems: CachedMessage[]
  draft: string
  setDraft: React.Dispatch<React.SetStateAction<string>>
  editingMessageId: string | null
  setEditingMessageId: (id: string | null) => void
  replyTargetMessageId: string | null
  setReplyTargetMessageId: (id: string | null) => void
  // ── Media recording ────────────────────────────────────────────────────────
  voiceNoteRecording: boolean
  roundVideoRecording: boolean
  // ── Group ──────────────────────────────────────────────────────────────────
  groupRenameTitle: string
  setGroupRenameTitle: React.Dispatch<React.SetStateAction<string>>
  groupMembers: GroupMember[]
  groupSenderKeys: GroupSenderKey[]
  // ── Sessions / prekeys / safety ────────────────────────────────────────────
  chatSessions: ChatDeviceSession[]
  setChatSessions: React.Dispatch<React.SetStateAction<ChatDeviceSession[]>>
  remotePrekeyBundles: PrekeyDeviceBundle[]
  safetyNumbers: SafetyNumberEntry[]
  verifyingSafetyDeviceId: string | null
  // ── Link previews / playback ───────────────────────────────────────────────
  linkMetadataByUrl: Record<string, LinkMetadata>
  attachmentPlaybackUrls: Record<string, string>
  // ── Outbox ─────────────────────────────────────────────────────────────────
  outboxPendingCount: number
  // ── Refs ───────────────────────────────────────────────────────────────────
  fileInputRef: React.RefObject<HTMLInputElement | null>
  draftInputRef: React.RefObject<HTMLTextAreaElement | null>
  // ── Handlers ───────────────────────────────────────────────────────────────
  handleSendMessage: (event: FormEvent<HTMLFormElement>) => Promise<void>
  handleAttachmentPick: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  handleVoiceNoteToggle: () => Promise<void>
  handleRoundVideoToggle: () => Promise<void>
  handleReplyToMessage: (message: CachedMessage) => void
  handleStartEditingMessage: (message: CachedMessage) => void
  handleDeleteExistingMessage: (message: CachedMessage) => Promise<void>
  handleToggleMessagePin: (message: CachedMessage) => Promise<void>
  handleDownloadAttachment: (attachment: AttachmentDescriptor) => Promise<void>
  ensureAttachmentPlaybackUrl: (attachment: AttachmentDescriptor) => Promise<string>
  handleVerifyPeerSafetyNumber: (peerDeviceId: string) => Promise<void>
  handleRekeyActiveChatSessions: () => Promise<void>
  handleRenameActiveGroupChat: (event: FormEvent<HTMLFormElement>) => Promise<void>
  handleUpdateActiveGroupMemberRole: (member: GroupMember, role: 'admin' | 'member') => Promise<void>
  handleRemoveActiveGroupMember: (member: GroupMember) => Promise<void>
  handleRotateGroupSenderKey: () => Promise<void>
  /** Sends the current draft without a form event (keyboard shortcut path). */
  sendDraftMessage: () => Promise<void>
  /** Resets all conversation state (called from handleForgetDevice). */
  reset: () => void
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseConversationParams {
  storedDevice: StoredDevice | null
  /** Exposed so syncChatSessionsFromServer can patch pruned one-time prekeys. */
  setStoredDevice: (device: StoredDevice | null) => void
  activeChatId: string | null
  deferredActiveChatId: string | null
  activeChat: ChatSummary | null
  chatItems: ChatSummary[]
  view: AuthView
  setLoading: (b: boolean) => void
  setBanner: (b: Banner | null) => void
  /** Called when messages sync should update the chat list summary. */
  onChatItemsChange: (updater: (current: ChatSummary[]) => ChatSummary[]) => void
}

export function useConversation({
  storedDevice,
  setStoredDevice,
  activeChatId,
  deferredActiveChatId,
  activeChat,
  chatItems,
  view,
  setLoading,
  setBanner,
  onChatItemsChange,
}: UseConversationParams): ConversationHookResult {
  // ── State ──────────────────────────────────────────────────────────────────
  const [messageItems, setMessageItems] = useState<CachedMessage[]>([])
  const [draft, setDraft] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [replyTargetMessageId, setReplyTargetMessageId] = useState<string | null>(null)
  const [voiceNoteRecording, setVoiceNoteRecording] = useState(false)
  const [roundVideoRecording, setRoundVideoRecording] = useState(false)
  const [groupRenameTitle, setGroupRenameTitle] = useState('')
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [groupSenderKeys, setGroupSenderKeys] = useState<GroupSenderKey[]>([])
  const [chatSessions, setChatSessions] = useState<ChatDeviceSession[]>([])
  const [remotePrekeyBundles, setRemotePrekeyBundles] = useState<PrekeyDeviceBundle[]>([])
  const [safetyNumbers, setSafetyNumbers] = useState<SafetyNumberEntry[]>([])
  const [verifyingSafetyDeviceId, setVerifyingSafetyDeviceId] = useState<string | null>(null)
  const [outboxPendingCount, setOutboxPendingCount] = useState(0)
  const [linkMetadataByUrl, setLinkMetadataByUrl] = useState<Record<string, LinkMetadata>>({})
  const [attachmentPlaybackUrls, setAttachmentPlaybackUrls] = useState<Record<string, string>>({})

  // ── Refs ───────────────────────────────────────────────────────────────────
  const activeChatIdRef = useRef<string | null>(deferredActiveChatId)
  const messageItemsRef = useRef<CachedMessage[]>([])
  const voiceNoteRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceNoteStreamRef = useRef<MediaStream | null>(null)
  const voiceNoteChunksRef = useRef<Blob[]>([])
  const roundVideoRecorderRef = useRef<MediaRecorder | null>(null)
  const roundVideoStreamRef = useRef<MediaStream | null>(null)
  const roundVideoChunksRef = useRef<Blob[]>([])
  const linkMetadataInFlightRef = useRef(new Set<string>())
  const attachmentPlaybackUrlsRef = useRef<Record<string, string>>({})
  const attachmentPlaybackInFlightRef = useRef<Map<string, Promise<string>>>(new Map())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null)

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeGroupChatId = activeChat?.type === 'group' ? activeChat.id : null

  const editingTargetMessage = editingMessageId
    ? messageItems.find((message) => message.id === editingMessageId) ?? null
    : null

  // ── Ref sync effects ───────────────────────────────────────────────────────
  useEffect(() => {
    activeChatIdRef.current = deferredActiveChatId
  }, [deferredActiveChatId])

  useEffect(() => {
    messageItemsRef.current = messageItems
  }, [messageItems])

  useEffect(() => {
    attachmentPlaybackUrlsRef.current = attachmentPlaybackUrls
  }, [attachmentPlaybackUrls])

  // ── Media cleanup on unmount ───────────────────────────────────────────────
  useEffect(
    () => () => {
      voiceNoteRecorderRef.current = null
      voiceNoteChunksRef.current = []
      if (voiceNoteStreamRef.current) {
        for (const track of voiceNoteStreamRef.current.getTracks()) track.stop()
      }
      voiceNoteStreamRef.current = null

      roundVideoRecorderRef.current = null
      roundVideoChunksRef.current = []
      if (roundVideoStreamRef.current) {
        for (const track of roundVideoStreamRef.current.getTracks()) track.stop()
      }
      roundVideoStreamRef.current = null

      for (const playbackUrl of Object.values(attachmentPlaybackUrlsRef.current)) {
        URL.revokeObjectURL(playbackUrl)
      }
      attachmentPlaybackUrlsRef.current = {}
      attachmentPlaybackInFlightRef.current.clear()
    },
    []
  )

  // ── Core helpers ───────────────────────────────────────────────────────────

  function replaceActiveMessages(chatId: string, nextMessages: CachedMessage[], syncSummary: boolean) {
    if (activeChatIdRef.current !== chatId) {
      return
    }
    messageItemsRef.current = nextMessages
    setMessageItems(nextMessages)
    void writeCachedMessages(chatId, nextMessages)

    if (syncSummary) {
      onChatItemsChange((current) => syncChatSummary(current, chatId, nextMessages))
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

  async function syncChatSessionsFromServer(
    chatId: string,
    knownRecipientDevices?: Array<{ device_id: string }>
  ): Promise<ChatDeviceSession[]> {
    if (!storedDevice || activeChatIdRef.current !== chatId) {
      return []
    }
    const recipientDevices =
      knownRecipientDevices ??
      (await listRecipientDevices(storedDevice.sessionToken, chatId)).recipient_devices
    const bootstrapTargetDeviceIds = recipientDevices
      .filter((device) => {
        const existingSession = chatSessions.find(
          (session) =>
            session.initiator_device_id === storedDevice.deviceId &&
            session.recipient_device_id === device.device_id &&
            session.session_state !== 'superseded'
        )
        return !existingSession || existingSession.establishment_state !== 'established'
      })
      .map((device) => device.device_id)
    const initiatorEphemeralKeys =
      bootstrapTargetDeviceIds.length > 0
        ? await prepareSessionBootstrap(bootstrapTargetDeviceIds)
        : {}
    const response = await bootstrapChatSessions(storedDevice.sessionToken, chatId, {
      initiator_ephemeral_keys: initiatorEphemeralKeys,
    })
    const synchronizedIds = await synchronizeChatSessions(
      toLocalSessionDeviceMaterial(storedDevice) as LocalSessionDeviceMaterial,
      response.sessions
    )
    const activeSessions = response.sessions.filter((session) => synchronizedIds.includes(session.id))
    const consumedOneTimePrekeys = pruneConsumedOneTimePrekeys(
      storedDevice.deviceId,
      response.sessions,
      storedDevice.oneTimePrekeys ?? []
    )

    if (consumedOneTimePrekeys.consumedPublicKeys.length > 0) {
      const nextStoredDevice: StoredDevice = {
        ...storedDevice,
        oneTimePrekeys: consumedOneTimePrekeys.nextOneTimePrekeys,
      }
      persistStoredDevice(nextStoredDevice)
      if (activeChatIdRef.current === chatId) {
        setStoredDevice(nextStoredDevice)
      }
    }

    if (activeChatIdRef.current === chatId) {
      setChatSessions(activeSessions)
    }

    return activeSessions
  }

  async function syncMessagesFromServerNow(chatId: string) {
    if (!storedDevice || activeChatIdRef.current !== chatId) {
      return
    }
    await syncChatSessionsFromServer(chatId)
    const response = await listMessages(storedDevice.sessionToken, chatId)
    const projected = await Promise.all(
      response.messages.map((message) =>
        projectMessage(message, storedDevice.deviceId, storedDevice.encryptionPrivateKeyPkcs8Base64)
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
      message: 'Realtime chat subscription failed. HTTP sync is still available.',
    })
  })

  // ── Load messages on active chat change ────────────────────────────────────
  useEffect(() => {
    if (!storedDevice || !deferredActiveChatId || view !== 'chat') {
      setChatSessions([])
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
        if (cancelled) return

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
  }, [deferredActiveChatId, storedDevice, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Clear link metadata / playback urls on chat change ─────────────────────
  useEffect(() => {
    linkMetadataInFlightRef.current.clear()
    setLinkMetadataByUrl({})

    for (const playbackUrl of Object.values(attachmentPlaybackUrlsRef.current)) {
      URL.revokeObjectURL(playbackUrl)
    }
    attachmentPlaybackInFlightRef.current.clear()
    attachmentPlaybackUrlsRef.current = {}
    setAttachmentPlaybackUrls({})
  }, [deferredActiveChatId])

  // ── Fetch link metadata ────────────────────────────────────────────────────
  useEffect(() => {
    if (!storedDevice || view !== 'chat') return

    const uniqueUrls = Array.from(
      new Set(
        messageItems
          .map((message) => {
            const match = message.text.match(/https?:\/\/[^\s]+/i)
            if (!match) return null
            try { return new URL(match[0]).href } catch { return null }
          })
          .filter((url): url is string => Boolean(url))
      )
    )
    if (uniqueUrls.length === 0) return

    const sessionToken = storedDevice.sessionToken

    for (const url of uniqueUrls) {
      if (linkMetadataByUrl[url] || linkMetadataInFlightRef.current.has(url)) continue

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
  }, [linkMetadataByUrl, messageItems, storedDevice, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime chat stream subscription ─────────────────────────────────────
  useEffect(() => {
    if (!storedDevice || !deferredActiveChatId || view !== 'chat') return

    const chatId = deferredActiveChatId
    return subscribeToChatStream(storedDevice.sessionToken, chatId, {
      onMessage(messageId) {
        handleRealtimeMessage(messageId, chatId)
      },
      onError: handleRealtimeSubscriptionError,
    })
  }, [deferredActiveChatId, storedDevice, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Remote prekeys ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!storedDevice || view !== 'chat') {
      setRemotePrekeyBundles([])
      return
    }

    const selectedChat =
      chatItems.find((chat) => chat.id === deferredActiveChatId) ?? chatItems[0] ?? null
    if (!selectedChat) {
      setRemotePrekeyBundles([])
      return
    }

    const targetUsername =
      selectedChat.participant_usernames.find(
        (participant) => participant !== storedDevice.username
      ) ?? storedDevice.username
    const sessionToken = storedDevice.sessionToken
    let cancelled = false

    async function loadRemotePrekeys() {
      try {
        const response = await fetchUserPrekeys(sessionToken, targetUsername)
        if (!cancelled) setRemotePrekeyBundles(response.devices)
      } catch {
        if (!cancelled) setRemotePrekeyBundles([])
      }
    }

    void loadRemotePrekeys()
    return () => { cancelled = true }
  }, [chatItems, deferredActiveChatId, storedDevice, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Safety numbers ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!storedDevice || !deferredActiveChatId || view !== 'chat') {
      setSafetyNumbers([])
      return
    }

    const sessionToken = storedDevice.sessionToken
    const chatId = deferredActiveChatId
    let cancelled = false

    async function loadSafetyNumbersForChat() {
      try {
        const response = await listSafetyNumbers(sessionToken, chatId)
        if (!cancelled) setSafetyNumbers(response.safety_numbers.map(toSafetyNumberEntry))
      } catch {
        if (!cancelled) setSafetyNumbers([])
      }
    }

    void loadSafetyNumbersForChat()
    return () => { cancelled = true }
  }, [deferredActiveChatId, storedDevice, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Group rename title sync ────────────────────────────────────────────────
  useEffect(() => {
    if (activeChat?.type === 'group') {
      setGroupRenameTitle(activeChat.title)
    } else {
      setGroupRenameTitle('')
    }
  }, [activeChat?.id, activeChat?.title, activeChat?.type])

  // ── Group members ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!storedDevice || view !== 'chat' || !activeGroupChatId) {
      setGroupMembers([])
      return
    }

    const { sessionToken } = storedDevice
    const groupChatId = activeGroupChatId
    let cancelled = false

    async function loadGroupMembers() {
      try {
        const response = await listGroupMembers(sessionToken, groupChatId)
        if (!cancelled) setGroupMembers(response.members)
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load group members.'
          setBanner({ tone: 'error', message })
          setGroupMembers([])
        }
      }
    }

    void loadGroupMembers()
    return () => { cancelled = true }
  }, [activeGroupChatId, storedDevice, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Group sender keys ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!storedDevice || view !== 'chat' || !activeGroupChatId) {
      setGroupSenderKeys([])
      return
    }

    const { sessionToken } = storedDevice
    const encryptionPrivateKeyPkcs8Base64 = storedDevice.encryptionPrivateKeyPkcs8Base64
    const groupChatId = activeGroupChatId
    let cancelled = false

    async function loadGroupSenderKeys() {
      try {
        const response = await listGroupSenderKeys(sessionToken, groupChatId)
        if (!cancelled) {
          await storeInboundGroupSenderKeys(
            groupChatId,
            response.sender_keys,
            encryptionPrivateKeyPkcs8Base64
          )
          setGroupSenderKeys(response.sender_keys)
        }
      } catch {
        if (!cancelled) setGroupSenderKeys([])
      }
    }

    void loadGroupSenderKeys()
    return () => { cancelled = true }
  }, [activeGroupChatId, storedDevice, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Outbox replay loop ─────────────────────────────────────────────────────
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

  useEffect(() => {
    let cancelled = false

    async function tickOutbox() {
      if (cancelled) return
      try {
        await replayOutboxMessages()
      } catch {
        // Ignore replay loop errors; next tick will retry.
      }
    }

    void tickOutbox()
    const timer = window.setInterval(() => { void tickOutbox() }, 8_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [storedDevice?.deviceId, storedDevice?.sessionToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Encryption helpers ─────────────────────────────────────────────────────

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
        )),
      }

      return {
        payload: replyToMessageId ? { ...payload, reply_to_message_id: replyToMessageId } : payload,
        deliveryMode: 'group_sender_key',
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
      ...(await encryptMessageWithSessions(plainText, storedDevice.deviceId, sessions)),
    }

    return {
      payload: replyToMessageId ? { ...payload, reply_to_message_id: replyToMessageId } : payload,
      deliveryMode: 'session',
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
      lastError,
    })
    setOutboxPendingCount(await countOutboxMessages())
  }

  async function uploadEncryptedAttachmentMultipart(
    sessionToken: string,
    fileName: string,
    mediaKind: 'file' | 'image' | 'audio' | 'video',
    encryptedAttachment: {
      contentType: string
      size: number
      ciphertextBase64: string
    }
  ): Promise<string> {
    const ciphertextBytes = base64ToBytes(encryptedAttachment.ciphertextBase64)
    const chunkByteSize = 192 * 1024
    const partCount = Math.max(1, Math.ceil(ciphertextBytes.byteLength / chunkByteSize))
    const createUploadResponse = await createMediaUpload(sessionToken, {
      filename: fileName,
      content_type: encryptedAttachment.contentType,
      declared_byte_size: encryptedAttachment.size,
      media_kind: mediaKind,
      expected_part_count: partCount,
    })
    const uploadId = createUploadResponse.upload.id
    let uploadedPartIndexes = new Set<number>(createUploadResponse.upload.uploaded_part_indexes ?? [])

    const uploadPartByIndex = async (partIndex: number) => {
      const start = partIndex * chunkByteSize
      const end = Math.min(start + chunkByteSize, ciphertextBytes.byteLength)
      const chunk = ciphertextBytes.subarray(start, end)
      const response = await appendMediaUploadPart(sessionToken, uploadId, {
        chunk: bytesToBase64(chunk),
        part_index: partIndex,
        part_count: partCount,
      })
      uploadedPartIndexes = new Set(response.upload.uploaded_part_indexes ?? [])
    }

    for (let pass = 0; pass < 3; pass += 1) {
      for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
        if (uploadedPartIndexes.has(partIndex)) continue
        try {
          await uploadPartByIndex(partIndex)
        } catch (error) {
          if (pass >= 2) throw error
          const snapshot = await fetchMediaUploadState(sessionToken, uploadId)
          uploadedPartIndexes = new Set(snapshot.upload.uploaded_part_indexes ?? [])
        }
      }
      if (uploadedPartIndexes.size >= partCount) break
    }

    if (uploadedPartIndexes.size < partCount) {
      throw new Error('Attachment upload is missing one or more encrypted chunks.')
    }

    const ciphertextSha256 = await sha256Hex(ciphertextBytes)
    await completeMediaUpload(sessionToken, uploadId, { ciphertext_sha256: ciphertextSha256 })
    return uploadId
  }

  // ── Message send flow ──────────────────────────────────────────────────────

  async function sendDraftMessage() {
    if (!storedDevice || !activeChatId || draft.trim() === '') return

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
              : 'Message edited with session encryption.',
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
      decryptable: true,
      reactions: [],
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
              : 'Session-bootstrapped encrypted envelope delivered to the server.',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send message.'
        if (shouldQueueOutboxSendFailure(message)) {
          await queueMessageForOutbox(activeChatId, payload, message)
          setBanner({ tone: 'info', message: 'Message queued for offline replay. It will retry automatically.' })
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

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await sendDraftMessage()
  }

  // ── Attachment handling ────────────────────────────────────────────────────

  function cleanupVoiceNoteCapture() {
    voiceNoteRecorderRef.current = null
    voiceNoteChunksRef.current = []
    if (voiceNoteStreamRef.current) {
      for (const track of voiceNoteStreamRef.current.getTracks()) track.stop()
    }
    voiceNoteStreamRef.current = null
    setVoiceNoteRecording(false)
  }

  function cleanupRoundVideoCapture() {
    roundVideoRecorderRef.current = null
    roundVideoChunksRef.current = []
    if (roundVideoStreamRef.current) {
      for (const track of roundVideoStreamRef.current.getTracks()) track.stop()
    }
    roundVideoStreamRef.current = null
    setRoundVideoRecording(false)
  }

  async function sendAttachmentFile(file: File) {
    if (!storedDevice || !activeChatId) return

    setLoading(true)
    setBanner({ tone: 'info', message: 'Encrypting and uploading attachment…' })

    const clientId = window.crypto.randomUUID()
    const optimisticId = `optimistic-${clientId}`
    const activeReplyToMessageId = replyTargetMessageId
    let thumbnailDataUrl: string | null = null
    let waveform: number[] | null = null

    try { thumbnailDataUrl = await generateAttachmentThumbnailDataUrl(file) } catch { thumbnailDataUrl = null }
    try { waveform = await generateAttachmentWaveform(file) } catch { waveform = null }

    const optimisticMessage: CachedMessage = {
      id: optimisticId,
      clientId,
      replyToMessageId: activeReplyToMessageId ?? undefined,
      text: `Attachment: ${file.name}`,
      sentAt: new Date().toISOString(),
      side: 'outgoing',
      decryptable: true,
      attachment: {
        uploadId: 'pending',
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        thumbnailDataUrl: thumbnailDataUrl ?? undefined,
        waveform: waveform ?? undefined,
      },
      reactions: [],
    }

    replaceActiveMessages(activeChatId, mergeMessageThread(messageItemsRef.current, optimisticMessage), true)
    setReplyTargetMessageId(null)

    try {
      const encryptedAttachment = await encryptAttachmentFile(file)
      const uploadId = await uploadEncryptedAttachmentMultipart(
        storedDevice.sessionToken,
        file.name,
        inferMediaKind(file.type),
        encryptedAttachment
      )

      const descriptor: AttachmentDescriptor = {
        kind: 'attachment',
        uploadId,
        fileName: file.name,
        contentType: encryptedAttachment.contentType,
        size: encryptedAttachment.size,
        thumbnailDataUrl: thumbnailDataUrl ?? undefined,
        waveform: waveform ?? undefined,
        contentKeyBase64: encryptedAttachment.contentKeyBase64,
        ivBase64: encryptedAttachment.ivBase64,
      }

      const { payload, deliveryMode } = await buildEncryptedMessagePayload(
        JSON.stringify(descriptor),
        activeChatId,
        clientId,
        'attachment',
        activeReplyToMessageId
      )

      try {
        const response = await createMessage(storedDevice.sessionToken, activeChatId, payload)
        await ingestMessageIntoActiveThread(response.message, activeChatId)
        setBanner({
          tone: 'success',
          message:
            deliveryMode === 'group_sender_key'
              ? 'Encrypted attachment uploaded and delivered with Sender Key transport.'
              : 'Encrypted attachment uploaded and delivered with session transport.',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send attachment.'
        if (shouldQueueOutboxSendFailure(message)) {
          await queueMessageForOutbox(activeChatId, payload, message)
          setBanner({ tone: 'info', message: 'Attachment message queued for offline replay. It will retry automatically.' })
          return
        }
        throw error
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send attachment.'
      setBanner({ tone: 'error', message })
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

  async function handleAttachmentPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !storedDevice || !activeChatId) return
    await sendAttachmentFile(file)
  }

  async function handleVoiceNoteToggle() {
    if (voiceNoteRecording) {
      const recorder = voiceNoteRecorderRef.current
      if (!recorder) { cleanupVoiceNoteCapture(); return }
      setBanner({ tone: 'info', message: 'Finishing voice note…' })
      recorder.stop()
      return
    }

    if (!activeChatId) {
      setBanner({ tone: 'error', message: 'Create or select a chat first.' })
      return
    }

    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      voiceNoteStreamRef.current = stream
      voiceNoteRecorderRef.current = recorder
      voiceNoteChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceNoteChunksRef.current.push(event.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(voiceNoteChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        cleanupVoiceNoteCapture()
        if (blob.size === 0) { setBanner({ tone: 'error', message: 'Voice note recording was empty.' }); return }
        const extension = (recorder.mimeType || 'audio/webm').includes('ogg') ? 'ogg' : 'webm'
        const file = new File([blob], `voice-note-${Date.now()}.${extension}`, { type: recorder.mimeType || 'audio/webm' })
        void sendAttachmentFile(file)
      }

      recorder.start()
      setVoiceNoteRecording(true)
      setBanner({ tone: 'info', message: 'Recording voice note… tap again to stop.' })
    } catch (error) {
      cleanupVoiceNoteCapture()
      const message = error instanceof Error ? error.message : 'Failed to start voice note recording.'
      setBanner({ tone: 'error', message })
    }
  }

  async function handleRoundVideoToggle() {
    if (roundVideoRecording) {
      const recorder = roundVideoRecorderRef.current
      if (!recorder) { cleanupRoundVideoCapture(); return }
      setBanner({ tone: 'info', message: 'Finishing round video…' })
      recorder.stop()
      return
    }

    if (!activeChatId) {
      setBanner({ tone: 'error', message: 'Create or select a chat first.' })
      return
    }

    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
      })
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
      roundVideoStreamRef.current = stream
      roundVideoRecorderRef.current = recorder
      roundVideoChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) roundVideoChunksRef.current.push(event.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(roundVideoChunksRef.current, { type: recorder.mimeType || 'video/webm' })
        cleanupRoundVideoCapture()
        if (blob.size === 0) { setBanner({ tone: 'error', message: 'Round video recording was empty.' }); return }
        const file = new File([blob], `round-video-${Date.now()}.webm`, { type: recorder.mimeType || 'video/webm' })
        void sendAttachmentFile(file)
      }

      recorder.start()
      setRoundVideoRecording(true)
      setBanner({ tone: 'info', message: 'Recording round video… tap again to stop.' })
    } catch (error) {
      cleanupRoundVideoCapture()
      const message = error instanceof Error ? error.message : 'Failed to start round video recording.'
      setBanner({ tone: 'error', message })
    }
  }

  async function ensureAttachmentPlaybackUrl(attachment: AttachmentDescriptor): Promise<string> {
    const existingUrl = attachmentPlaybackUrlsRef.current[attachment.uploadId]
    if (existingUrl) return existingUrl

    const inFlight = attachmentPlaybackInFlightRef.current.get(attachment.uploadId)
    if (inFlight) return inFlight

    if (!storedDevice) throw new Error('No local device identity is available.')

    const promise = (async () => {
      const response = await fetchMediaUpload(storedDevice.sessionToken, attachment.uploadId)
      if (!response.upload.ciphertext) {
        throw new Error('The encrypted attachment payload is missing on the server.')
      }
      const blob = await decryptAttachmentFile(
        response.upload.ciphertext,
        attachment.contentKeyBase64,
        attachment.ivBase64,
        attachment.contentType
      )
      const playbackUrl = URL.createObjectURL(blob)
      setAttachmentPlaybackUrls((current) => {
        const previous = current[attachment.uploadId]
        if (previous && previous !== playbackUrl) URL.revokeObjectURL(previous)
        return { ...current, [attachment.uploadId]: playbackUrl }
      })
      return playbackUrl
    })()

    attachmentPlaybackInFlightRef.current.set(attachment.uploadId, promise)
    try { return await promise } finally {
      attachmentPlaybackInFlightRef.current.delete(attachment.uploadId)
    }
  }

  async function handleDownloadAttachment(attachment: AttachmentDescriptor) {
    if (!storedDevice) { setBanner({ tone: 'error', message: 'No local device identity is available.' }); return }

    setLoading(true)
    setBanner({ tone: 'info', message: `Downloading ${attachment.fileName}…` })

    try {
      const response = await fetchMediaUpload(storedDevice.sessionToken, attachment.uploadId)
      if (!response.upload.ciphertext) {
        throw new Error('The encrypted attachment payload is missing on the server.')
      }
      const blob = await decryptAttachmentFile(
        response.upload.ciphertext,
        attachment.contentKeyBase64,
        attachment.ivBase64,
        attachment.contentType
      )
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = attachment.fileName
      anchor.click()
      URL.revokeObjectURL(url)
      setBanner({ tone: 'success', message: `${attachment.fileName} downloaded and decrypted.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download attachment.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  // ── Message actions ────────────────────────────────────────────────────────

  function handleReplyToMessage(message: CachedMessage) {
    if (message.side === 'system' || message.deletedAt) return
    setEditingMessageId(null)
    setReplyTargetMessageId(message.id)
    draftInputRef.current?.focus()
  }

  function handleStartEditingMessage(message: CachedMessage) {
    if (message.side !== 'outgoing' || message.attachment || message.deletedAt) return
    setEditingMessageId(message.id)
    setReplyTargetMessageId(message.replyToMessageId ?? null)
    setDraft(message.text)
    draftInputRef.current?.focus()
  }

  async function handleDeleteExistingMessage(message: CachedMessage) {
    if (!storedDevice || !activeChatId || message.side !== 'outgoing' || message.deletedAt) return

    setLoading(true)

    try {
      const response = await deleteMessage(storedDevice.sessionToken, activeChatId, message.id)
      await ingestMessageIntoActiveThread(response.message, activeChatId)
      if (editingMessageId === message.id) { setEditingMessageId(null); setDraft('') }
      if (replyTargetMessageId === message.id) setReplyTargetMessageId(null)
      setBanner({ tone: 'success', message: 'Message deleted for this chat.' })
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to delete the message.'
      setBanner({ tone: 'error', message: messageText })
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleMessagePin(message: CachedMessage) {
    if (
      !storedDevice ||
      !activeChatId ||
      message.side === 'system' ||
      message.deletedAt ||
      message.id.startsWith('optimistic-')
    ) return

    setLoading(true)

    try {
      const response = await toggleMessagePin(storedDevice.sessionToken, activeChatId, message.id)
      await syncMessagesFromServerNow(activeChatId)
      setBanner({
        tone: 'success',
        message: response.message.pinned_at
          ? 'Pinned message updated for this chat.'
          : 'Pinned message cleared.',
      })
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to update the pinned message.'
      setBanner({ tone: 'error', message: messageText })
    } finally {
      setLoading(false)
    }
  }

  // ── Safety numbers ─────────────────────────────────────────────────────────

  async function handleVerifyPeerSafetyNumber(peerDeviceId: string) {
    if (!storedDevice || !activeChatId) return

    setVerifyingSafetyDeviceId(peerDeviceId)

    try {
      const response = await verifySafetyNumber(storedDevice.sessionToken, activeChatId, peerDeviceId)
      setSafetyNumbers((current) =>
        current.map((entry) =>
          entry.peerDeviceId === response.safety_number.peer_device_id
            ? toSafetyNumberEntry(response.safety_number)
            : entry
        )
      )
      setBanner({
        tone: 'success',
        message: `Verified safety number for ${response.safety_number.peer_device_name}.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to verify safety number.'
      setBanner({ tone: 'error', message })
    } finally {
      setVerifyingSafetyDeviceId(null)
    }
  }

  // ── Session / prekey management ────────────────────────────────────────────

  async function handleRekeyActiveChatSessions() {
    if (!storedDevice || !activeChatId) {
      setBanner({ tone: 'error', message: 'Select a chat before rekeying direct-chat sessions.' })
      return
    }

    setLoading(true)

    try {
      const recipientDevices = (
        await listRecipientDevices(storedDevice.sessionToken, activeChatId)
      ).recipient_devices
      const initiatorEphemeralKeys = await prepareSessionBootstrap(
        recipientDevices.map((device) => device.device_id)
      )
      const response = await rekeyChatSessions(storedDevice.sessionToken, activeChatId, {
        initiator_ephemeral_keys: initiatorEphemeralKeys,
      })
      const synchronizedIds = await synchronizeChatSessions(
        toLocalSessionDeviceMaterial(storedDevice) as LocalSessionDeviceMaterial,
        response.sessions
      )
      const updatedSessions = response.sessions.filter((session) => synchronizedIds.includes(session.id))
      const consumedOneTimePrekeys = pruneConsumedOneTimePrekeys(
        storedDevice.deviceId,
        response.sessions,
        storedDevice.oneTimePrekeys ?? []
      )
      const mergedSessions = [
        ...chatSessions.filter(
          (existing) =>
            !updatedSessions.some(
              (next) =>
                next.chat_id === existing.chat_id &&
                next.initiator_device_id === existing.initiator_device_id &&
                next.recipient_device_id === existing.recipient_device_id
            )
        ),
        ...updatedSessions,
      ]

      if (consumedOneTimePrekeys.consumedPublicKeys.length > 0) {
        const nextStoredDevice: StoredDevice = {
          ...storedDevice,
          oneTimePrekeys: consumedOneTimePrekeys.nextOneTimePrekeys,
        }
        persistStoredDevice(nextStoredDevice)
        if (activeChatIdRef.current === activeChatId) setStoredDevice(nextStoredDevice)
      }

      if (activeChatIdRef.current === activeChatId) {
        setChatSessions(mergedSessions)
      }

      setBanner({
        tone: 'success',
        message: `Rekeyed ${updatedSessions.length} direct-chat session ${updatedSessions.length === 1 ? 'record' : 'records'}.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rekey chat sessions.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  // ── Group management ───────────────────────────────────────────────────────

  async function handleRenameActiveGroupChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!storedDevice || !activeChat || activeChat.type !== 'group' || groupRenameTitle.trim() === '') {
      return
    }

    setLoading(true)

    try {
      const response = await renameGroupChat(storedDevice.sessionToken, activeChat.id, {
        title: groupRenameTitle.trim(),
      })
      onChatItemsChange((current) =>
        current.map((chat) => (chat.id === activeChat.id ? response.chat : chat))
      )
      setGroupRenameTitle(response.chat.title)
      setBanner({ tone: 'success', message: `Group updated: ${response.chat.title}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename the group.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdateActiveGroupMemberRole(member: GroupMember, role: 'admin' | 'member') {
    if (!storedDevice || !activeChat || activeChat.type !== 'group' || member.role === role) return

    setLoading(true)

    try {
      const response = await updateGroupMemberRole(
        storedDevice.sessionToken,
        activeChat.id,
        member.user_id,
        role
      )
      setGroupMembers((current) =>
        current.map((entry) => (entry.user_id === response.member.user_id ? response.member : entry))
      )
      setBanner({ tone: 'success', message: `${response.member.username} is now ${response.member.role}.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update the group member.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleRemoveActiveGroupMember(member: GroupMember) {
    if (!storedDevice || !activeChat || activeChat.type !== 'group') return

    setLoading(true)

    try {
      const response = await removeGroupMember(
        storedDevice.sessionToken,
        activeChat.id,
        member.user_id
      )
      setGroupMembers((current) =>
        current.filter((entry) => entry.user_id !== response.member.user_id)
      )
      onChatItemsChange((current) =>
        current.map((chat) =>
          chat.id === activeChat.id
            ? {
                ...chat,
                participant_usernames: chat.participant_usernames.filter(
                  (username) => username !== response.member.username
                ),
              }
            : chat
        )
      )
      setBanner({ tone: 'success', message: `${response.member.username} was removed from the group.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove the group member.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleRotateGroupSenderKey() {
    if (!storedDevice || !activeChat || activeChat.type !== 'group') return

    setLoading(true)

    try {
      const recipientDevices = (
        await listRecipientDevices(storedDevice.sessionToken, activeChat.id)
      ).recipient_devices.filter((device) => device.device_id !== storedDevice.deviceId)

      if (recipientDevices.length === 0) {
        throw new Error('No recipient devices are currently available for sender key distribution.')
      }

      const senderKeyMaterial = window.crypto.getRandomValues(new Uint8Array(32))
      const senderKeyMaterialBase64 = bytesToBase64(senderKeyMaterial)
      const keyId = `sender-${Date.now()}-${window.crypto.randomUUID()}`
      const wrappedKeys = await wrapGroupSenderKeyForRecipients(senderKeyMaterialBase64, recipientDevices)
      const currentActiveSenderKey = getActiveGroupSenderKey(activeChat.id)
      const nextEpoch = currentActiveSenderKey ? currentActiveSenderKey.epoch + 1 : 1
      const response = await distributeGroupSenderKeys(storedDevice.sessionToken, activeChat.id, {
        key_id: keyId,
        sender_key_epoch: nextEpoch,
        algorithm: 'p256-ecdh+a256gcm',
        wrapped_keys: wrappedKeys,
      })

      storeGroupSenderKeyMaterial(activeChat.id, keyId, senderKeyMaterialBase64)
      setActiveGroupSenderKey(activeChat.id, keyId, nextEpoch)
      setGroupSenderKeys(response.sender_keys)
      setBanner({
        tone: 'success',
        message: `Distributed Sender Key ${keyId} (epoch ${nextEpoch}) to ${response.sender_keys.length} recipient device${response.sender_keys.length === 1 ? '' : 's'}.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rotate the group Sender Key.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

  function reset() {
    setMessageItems([])
    setDraft('')
    setEditingMessageId(null)
    setReplyTargetMessageId(null)
    setVoiceNoteRecording(false)
    setRoundVideoRecording(false)
    setGroupRenameTitle('')
    setGroupMembers([])
    setGroupSenderKeys([])
    setChatSessions([])
    setRemotePrekeyBundles([])
    setSafetyNumbers([])
    setVerifyingSafetyDeviceId(null)
    setOutboxPendingCount(0)
    setLinkMetadataByUrl({})

    // Revoke all playback object URLs
    for (const url of Object.values(attachmentPlaybackUrlsRef.current)) {
      URL.revokeObjectURL(url)
    }
    attachmentPlaybackUrlsRef.current = {}
    attachmentPlaybackInFlightRef.current.clear()
    setAttachmentPlaybackUrls({})

    // Cleanup media capture
    if (voiceNoteStreamRef.current) {
      for (const track of voiceNoteStreamRef.current.getTracks()) track.stop()
      voiceNoteStreamRef.current = null
    }
    if (roundVideoStreamRef.current) {
      for (const track of roundVideoStreamRef.current.getTracks()) track.stop()
      roundVideoStreamRef.current = null
    }
    voiceNoteRecorderRef.current = null
    voiceNoteChunksRef.current = []
    roundVideoRecorderRef.current = null
    roundVideoChunksRef.current = []
  }

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    messageItems,
    draft,
    setDraft,
    editingMessageId,
    setEditingMessageId,
    replyTargetMessageId,
    setReplyTargetMessageId,
    voiceNoteRecording,
    roundVideoRecording,
    groupRenameTitle,
    setGroupRenameTitle,
    groupMembers,
    groupSenderKeys,
    chatSessions,
    setChatSessions,
    remotePrekeyBundles,
    safetyNumbers,
    verifyingSafetyDeviceId,
    linkMetadataByUrl,
    attachmentPlaybackUrls,
    outboxPendingCount,
    fileInputRef,
    draftInputRef,
    sendDraftMessage,
    handleSendMessage,
    handleAttachmentPick,
    handleVoiceNoteToggle,
    handleRoundVideoToggle,
    handleReplyToMessage,
    handleStartEditingMessage,
    handleDeleteExistingMessage,
    handleToggleMessagePin,
    handleDownloadAttachment,
    ensureAttachmentPlaybackUrl,
    handleVerifyPeerSafetyNumber,
    handleRekeyActiveChatSessions,
    handleRenameActiveGroupChat,
    handleUpdateActiveGroupMemberRole,
    handleRemoveActiveGroupMember,
    handleRotateGroupSenderKey,
    reset,
  }
}
