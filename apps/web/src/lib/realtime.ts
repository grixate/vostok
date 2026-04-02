import { Socket, Presence, type Channel } from 'phoenix'
import type { CallParticipant, CallRoomState, CallScope, CallSession, CallSignal } from './api'

type RealtimeTestWindow = Window & {
  __VOSTOK_TEST_DISABLE_REALTIME__?: boolean
}

type ChatMessageHandler = {
  onMessage: (messageId: string) => void
  onError?: () => void
}

type CallStateHandler = {
  onState: (call: CallSession | null) => void
  onParticipants?: (payload: { callId: string; participants: CallParticipant[]; room: CallRoomState | null }) => void
  onSignal?: (payload: { callId: string; signal: CallSignal }) => void
  onError?: () => void
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

let defaultRealtimeBaseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'

let connectionStatus: ConnectionStatus = 'disconnected'
let hasEverConnected = false
const statusListeners = new Set<(s: ConnectionStatus) => void>()
const reconnectListeners = new Set<() => void>()

function isRealtimeDisabledForTests(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return Boolean((window as RealtimeTestWindow).__VOSTOK_TEST_DISABLE_REALTIME__)
}

function notifyStatusListeners() {
  for (const cb of statusListeners) {
    cb(connectionStatus)
  }

  // Fire reconnect callbacks when recovering from a drop (not on first connect)
  if (connectionStatus === 'connected') {
    if (hasEverConnected) {
      // This is a RE-connect — sync everything
      for (const cb of reconnectListeners) {
        try { cb() } catch { /* ignore */ }
      }
    }
    hasEverConnected = true
  }
}

export function subscribeToConnectionStatus(cb: (s: ConnectionStatus) => void): () => void {
  statusListeners.add(cb)
  cb(isRealtimeDisabledForTests() ? 'connected' : connectionStatus)
  return () => statusListeners.delete(cb)
}

/** Subscribe to reconnection events — fires when socket recovers after a drop. */
export function subscribeToReconnect(cb: () => void): () => void {
  if (isRealtimeDisabledForTests()) {
    return () => {}
  }

  reconnectListeners.add(cb)
  return () => reconnectListeners.delete(cb)
}

export function setDefaultRealtimeBaseUrl(baseUrl: string | null) {
  const nextBaseUrl = baseUrl && baseUrl.trim() !== ''
    ? baseUrl.trim().replace(/\/+$/, '')
    : (typeof window !== 'undefined' ? window.location.origin : defaultRealtimeBaseUrl)

  if (nextBaseUrl === defaultRealtimeBaseUrl) {
    return
  }

  defaultRealtimeBaseUrl = nextBaseUrl

  if (deviceSocket) {
    deviceSocket.disconnect()
    deviceSocket = null
    deviceSocketToken = null
    chatChannels.clear()
    connectionStatus = 'disconnected'
    notifyStatusListeners()
  }
}

export function getDefaultRealtimeBaseUrl(): string {
  return defaultRealtimeBaseUrl
}

let deviceSocket: Socket | null = null
let deviceSocketToken: string | null = null

type UserActivityHandler = {
  onChatActivity: (chatId: string) => void
}

export function subscribeToUserStream(
  token: string,
  userId: string,
  handlers: UserActivityHandler
): () => void {
  if (isRealtimeDisabledForTests()) {
    return () => {}
  }

  const socket = ensureDeviceSocket(token)
  const channel = socket.channel(`user:${userId}`)

  channel.on('chat:activity', (payload: unknown) => {
    if (payload && typeof payload === 'object') {
      const chatId = (payload as { chat_id?: unknown }).chat_id
      if (typeof chatId === 'string') {
        handlers.onChatActivity(chatId)
      }
    }
  })

  channel
    .join()
    .receive('error', () => {
      console.warn('[subscribeToUserStream] Failed to join user channel')
    })

  return () => {
    teardownChannel(channel, ['chat:activity'])
  }
}

export function subscribeToChatStream(
  token: string,
  chatId: string,
  handlers: ChatMessageHandler
): () => void {
  if (isRealtimeDisabledForTests()) {
    return () => {}
  }

  const channel = ensureChatChannel(token, chatId)

  channel.on('message:new', (payload: unknown) => {
    const messageId = readMessageId(payload)

    if (messageId) {
      handlers.onMessage(messageId)
    }
  })

  return () => {
    channel.off('message:new')
  }
}

export function subscribeToCallStream(
  token: string,
  scope: CallScope,
  handlers: CallStateHandler
): () => void {
  if (isRealtimeDisabledForTests()) {
    return () => {}
  }

  const socket = ensureDeviceSocket(token)
  const topic = scope.type === 'chat' ? `call:${scope.chatId}` : `call-room:${scope.roomId}`
  const channel = socket.channel(topic)

  channel.on('call:state', (payload: unknown) => {
    handlers.onState(readCallState(payload))
  })

  channel.on('call:participant_state', (payload: unknown) => {
    const participantPayload = readParticipantState(payload)

    if (participantPayload) {
      handlers.onParticipants?.(participantPayload)
    }
  })

  channel.on('call:signal', (payload: unknown) => {
    const signalPayload = readSignalPayload(payload)

    if (signalPayload) {
      handlers.onSignal?.(signalPayload)
    }
  })

  channel
    .join()
    .receive('error', () => handlers.onError?.())

  return () => {
    teardownChannel(channel, ['call:state', 'call:participant_state', 'call:signal'])
  }
}

// ── Typing Indicators ───────────────────────────────────────────────────────

type TypingHandler = {
  onTypingStart: (userId: string, username: string) => void
  onTypingStop: (userId: string) => void
}

const chatChannels = new Map<string, Channel>()

function ensureChatChannel(token: string, chatId: string): Channel {
  const key = `chat:${chatId}`
  const existing = chatChannels.get(key)

  // Only reuse a channel if it belongs to the current socket
  if (existing && deviceSocket && existing.socket === deviceSocket) {
    return existing
  }

  // Remove stale channel if socket changed
  if (existing) {
    chatChannels.delete(key)
  }

  const socket = ensureDeviceSocket(token)
  const channel = socket.channel(key)
  channel.join()
    .receive('error', () => {
      console.warn(`[realtime] Failed to join channel ${key}`)
      chatChannels.delete(key)
    })
  chatChannels.set(key, channel)
  return channel
}

export function subscribeToTyping(
  token: string,
  chatId: string,
  handlers: TypingHandler
): () => void {
  if (isRealtimeDisabledForTests()) {
    return () => {}
  }

  const channel = ensureChatChannel(token, chatId)

  channel.on('typing:start', (payload: unknown) => {
    if (payload && typeof payload === 'object') {
      const p = payload as { user_id?: string; username?: string }
      if (typeof p.user_id === 'string') {
        handlers.onTypingStart(p.user_id, p.username ?? 'Someone')
      }
    }
  })

  channel.on('typing:stop', (payload: unknown) => {
    if (payload && typeof payload === 'object') {
      const p = payload as { user_id?: string }
      if (typeof p.user_id === 'string') {
        handlers.onTypingStop(p.user_id)
      }
    }
  })

  return () => {
    channel.off('typing:start')
    channel.off('typing:stop')
  }
}

export function pushTypingStart(token: string, chatId: string): void {
  if (isRealtimeDisabledForTests()) {
    return
  }

  const channel = ensureChatChannel(token, chatId)
  channel.push('typing:start', {})
}

export function pushTypingStop(token: string, chatId: string): void {
  if (isRealtimeDisabledForTests()) {
    return
  }

  const channel = ensureChatChannel(token, chatId)
  channel.push('typing:stop', {})
}

// ── Read Receipt Subscription ───────────────────────────────────────────────

type ReadReceiptHandler = {
  onReadUpdate: (userId: string, lastReadMessageId: string | null, readAt: string | null) => void
}

export function subscribeToReadReceipts(
  token: string,
  chatId: string,
  handlers: ReadReceiptHandler
): () => void {
  if (isRealtimeDisabledForTests()) {
    return () => {}
  }

  const channel = ensureChatChannel(token, chatId)

  channel.on('read:update', (payload: unknown) => {
    if (payload && typeof payload === 'object') {
      const p = payload as { user_id?: string; last_read_message_id?: string; read_at?: string }
      if (typeof p.user_id === 'string') {
        handlers.onReadUpdate(p.user_id, p.last_read_message_id ?? null, p.read_at ?? null)
      }
    }
  })

  return () => {
    channel.off('read:update')
  }
}

// ── Presence ────────────────────────────────────────────────────────────────

type PresenceHandler = {
  onSync: (onlineUserIds: Set<string>) => void
}

export function subscribeToPresence(
  token: string,
  handlers: PresenceHandler
): () => void {
  if (isRealtimeDisabledForTests()) {
    handlers.onSync(new Set())
    return () => {}
  }

  const socket = ensureDeviceSocket(token)
  const channel = socket.channel('presence:lobby')

  const presence = new Presence(channel)

  presence.onSync(() => {
    const online = new Set<string>()
    presence.list((userId: string) => {
      online.add(userId)
      return userId
    })
    handlers.onSync(online)
  })

  channel
    .join()
    .receive('error', () => {
      console.warn('[subscribeToPresence] Failed to join presence channel')
    })

  return () => {
    void channel.leave()
  }
}

function ensureDeviceSocket(token: string): Socket {
  if (isRealtimeDisabledForTests()) {
    connectionStatus = 'connected'
    return deviceSocket as Socket
  }

  if (deviceSocket && deviceSocketToken === token) {
    return deviceSocket
  }

  // If a socket already exists and is connected, keep it alive — just
  // record the new token so reconnections use it.  Tearing down the socket
  // on every token refresh kills all live channels (chat, presence, calls)
  // and triggers a cascade of reconnections.
  if (deviceSocket && connectionStatus === 'connected') {
    deviceSocketToken = token
    // Update params so reconnections use the fresh token
    ;(deviceSocket as Socket & { params: () => Record<string, string> }).params = () => ({ token })
    return deviceSocket
  }

  if (deviceSocket) {
    deviceSocket.disconnect()
  }

  // Clear cached channels — they belong to the old socket
  chatChannels.clear()

  const socket = new Socket(toSocketUrl(defaultRealtimeBaseUrl), {
    params: { token },
    // Desktop app: aggressive reconnection — never give up
    reconnectAfterMs: (tries: number) => Math.min(1000 * Math.pow(2, tries), 30000),
    heartbeatIntervalMs: 20000,
    rejoinAfterMs: (tries: number) => Math.min(1000 * Math.pow(2, tries), 10000)
  })
  deviceSocket = socket
  deviceSocketToken = token

  connectionStatus = 'connecting'
  notifyStatusListeners()

  // Guard status updates so a stale socket's close/error callbacks
  // don't overwrite the current socket's status.
  socket.onOpen(() => { if (deviceSocket === socket) { connectionStatus = 'connected'; notifyStatusListeners() } })
  socket.onClose(() => { if (deviceSocket === socket) { connectionStatus = 'disconnected'; notifyStatusListeners() } })
  socket.onError(() => { if (deviceSocket === socket) { connectionStatus = 'error'; notifyStatusListeners() } })

  socket.connect()

  return socket
}

function toSocketUrl(baseUrl: string): string {
  const normalized = new URL(baseUrl)
  normalized.protocol = normalized.protocol === 'https:' ? 'wss:' : 'ws:'
  normalized.pathname = '/socket/device'
  normalized.search = ''
  normalized.hash = ''
  return normalized.toString()
}

function teardownChannel(channel: Channel, events: string[]) {
  for (const event of events) {
    channel.off(event)
  }

  void channel.leave()
}

function readMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  return typeof (payload as { message_id?: unknown }).message_id === 'string'
    ? (payload as { message_id: string }).message_id
    : null
}

function readCallState(payload: unknown): CallSession | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const value = (payload as { call?: unknown }).call

  if (!value || typeof value !== 'object') {
    return null
  }

  const call = value as Record<string, unknown>

  if (
    typeof call.id !== 'string' ||
    typeof call.started_by_device_id !== 'string' ||
    typeof call.mode !== 'string' ||
    typeof call.media_mode !== 'string' ||
    typeof call.scope_type !== 'string' ||
    typeof call.scope_id !== 'string' ||
    typeof call.status !== 'string' ||
    typeof call.started_at !== 'string'
  ) {
    return null
  }

  return {
    id: call.id,
    chat_id: typeof call.chat_id === 'string' ? call.chat_id : null,
    call_room_id: typeof call.call_room_id === 'string' ? call.call_room_id : null,
    scope_type: call.scope_type as CallSession['scope_type'],
    scope_id: call.scope_id,
    started_by_device_id: call.started_by_device_id,
    mode: call.mode as CallSession['mode'],
    media_mode: call.media_mode as CallSession['media_mode'],
    status: call.status as CallSession['status'],
    started_at: call.started_at,
    ended_at: typeof call.ended_at === 'string' ? call.ended_at : null,
    end_reason: typeof call.end_reason === 'string' ? call.end_reason : null,
    display_title: typeof call.display_title === 'string' ? call.display_title : null
  }
}

function readParticipantState(
  payload: unknown
): { callId: string; participants: CallParticipant[]; room: CallRoomState | null } | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const value = payload as {
    call_id?: unknown
    participants?: unknown
    room?: unknown
  }

  if (typeof value.call_id !== 'string' || !Array.isArray(value.participants)) {
    return null
  }

  const participants = value.participants
    .map((participant) => readParticipant(participant))
    .filter((participant): participant is CallParticipant => participant !== null)

  return {
    callId: value.call_id,
    participants,
    room: readRoomState(value.room)
  }
}

function readParticipant(payload: unknown): CallParticipant | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const participant = payload as Record<string, unknown>

  if (
    typeof participant.id !== 'string' ||
    typeof participant.call_id !== 'string' ||
    typeof participant.user_id !== 'string' ||
    typeof participant.device_id !== 'string' ||
    typeof participant.status !== 'string' ||
    typeof participant.track_kind !== 'string' ||
    typeof participant.joined_at !== 'string'
  ) {
    return null
  }

  return {
    id: participant.id,
    call_id: participant.call_id,
    user_id: participant.user_id,
    username: typeof participant.username === 'string' ? participant.username : null,
    display_name: typeof participant.display_name === 'string' ? participant.display_name : null,
    device_id: participant.device_id,
    status: participant.status as CallParticipant['status'],
    track_kind: participant.track_kind as CallParticipant['track_kind'],
    e2ee_capable: participant.e2ee_capable === true,
    e2ee_algorithm:
      typeof participant.e2ee_algorithm === 'string' ? participant.e2ee_algorithm : null,
    e2ee_key_epoch:
      typeof participant.e2ee_key_epoch === 'number' ? participant.e2ee_key_epoch : null,
    joined_at: participant.joined_at,
    left_at: typeof participant.left_at === 'string' ? participant.left_at : null
  }
}

function readRoomState(payload: unknown): CallRoomState | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const room = payload as Record<string, unknown>

  if (
    typeof room.backend !== 'string' ||
    typeof room.call_id !== 'string' ||
    typeof room.mode !== 'string' ||
    typeof room.participant_count !== 'number' ||
    !Array.isArray(room.active_device_ids)
  ) {
    return null
  }

  const activeDeviceIds = room.active_device_ids.filter(
    (value): value is string => typeof value === 'string'
  )

  return {
    backend: room.backend,
    call_id: room.call_id,
    mode: room.mode as CallRoomState['mode'],
    participant_count: room.participant_count,
    active_device_ids: activeDeviceIds,
    endpoint_count: typeof room.endpoint_count === 'number' ? room.endpoint_count : undefined,
    engine_pid: typeof room.engine_pid === 'string' ? room.engine_pid : undefined,
    forwarded_track_count:
      typeof room.forwarded_track_count === 'number' ? room.forwarded_track_count : undefined,
    track_count: typeof room.track_count === 'number' ? room.track_count : undefined,
    webrtc_endpoint_count:
      typeof room.webrtc_endpoint_count === 'number' ? room.webrtc_endpoint_count : undefined
  }
}

function readSignalPayload(payload: unknown): { callId: string; signal: CallSignal } | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const value = payload as {
    call_id?: unknown
    signal?: unknown
  }

  if (typeof value.call_id !== 'string') {
    return null
  }

  const signal = readSignal(value.signal)

  if (!signal) {
    return null
  }

  return {
    callId: value.call_id,
    signal
  }
}

function readSignal(payload: unknown): CallSignal | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const signal = payload as Record<string, unknown>

  if (
    typeof signal.id !== 'string' ||
    typeof signal.call_id !== 'string' ||
    typeof signal.from_device_id !== 'string' ||
    typeof signal.signal_type !== 'string' ||
    typeof signal.payload !== 'string' ||
    typeof signal.inserted_at !== 'string'
  ) {
    return null
  }

  return {
    id: signal.id,
    call_id: signal.call_id,
    from_device_id: signal.from_device_id,
    target_device_id: typeof signal.target_device_id === 'string' ? signal.target_device_id : null,
    signal_type: signal.signal_type as CallSignal['signal_type'],
    payload: signal.payload,
    inserted_at: signal.inserted_at
  }
}
