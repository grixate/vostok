import { Socket, type Channel } from 'phoenix'
import type { CallParticipant, CallRoomState, CallSession, CallSignal } from './api'

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

let deviceSocket: Socket | null = null
let deviceSocketToken: string | null = null

export function subscribeToChatStream(
  token: string,
  chatId: string,
  handlers: ChatMessageHandler
): () => void {
  const socket = ensureDeviceSocket(token)
  const channel = socket.channel(`chat:${chatId}`)

  channel.on('message:new', (payload: unknown) => {
    const messageId = readMessageId(payload)

    if (messageId) {
      handlers.onMessage(messageId)
    }
  })

  channel
    .join()
    .receive('error', () => handlers.onError?.())

  return () => {
    teardownChannel(channel, ['message:new'])
  }
}

export function subscribeToCallStream(
  token: string,
  chatId: string,
  handlers: CallStateHandler
): () => void {
  const socket = ensureDeviceSocket(token)
  const channel = socket.channel(`call:${chatId}`)

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

function ensureDeviceSocket(token: string): Socket {
  if (deviceSocket && deviceSocketToken === token) {
    return deviceSocket
  }

  if (deviceSocket) {
    deviceSocket.disconnect()
  }

  deviceSocket = new Socket('/socket/device', {
    params: { token }
  })
  deviceSocketToken = token
  deviceSocket.connect()

  return deviceSocket
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
    typeof call.chat_id !== 'string' ||
    typeof call.started_by_device_id !== 'string' ||
    typeof call.mode !== 'string' ||
    typeof call.status !== 'string' ||
    typeof call.started_at !== 'string'
  ) {
    return null
  }

  return {
    id: call.id,
    chat_id: call.chat_id,
    started_by_device_id: call.started_by_device_id,
    mode: call.mode as CallSession['mode'],
    status: call.status as CallSession['status'],
    started_at: call.started_at,
    ended_at: typeof call.ended_at === 'string' ? call.ended_at : null
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
    device_id: participant.device_id,
    status: participant.status as CallParticipant['status'],
    track_kind: participant.track_kind as CallParticipant['track_kind'],
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
