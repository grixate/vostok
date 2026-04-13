import type {
  CallParticipant,
  CallRoom,
  CallRoomMember,
  CallRoomState,
  CallSession,
  CallSignal,
  CallWebRtcEndpointState
} from './api.ts'
import type { MergedChatSummary } from './multi-server.ts'

export type ChatScopedActiveCallDecision =
  | { kind: 'reset_all' }
  | { kind: 'preserve_current' }
  | { kind: 'preserve_other_chat' }
  | { kind: 'clear_current' }
  | { kind: 'load'; rawChatId: string }

export function resolveChatScopedActiveCallDecision(
  activeCall: CallSession | null,
  activeCallChatId: string | null,
  deferredActiveChatId: string | null,
  getRawChatId: (chatId: string | null) => string | null
): ChatScopedActiveCallDecision {
  const hasOngoingCall =
    activeCall !== null &&
    (activeCall.status === 'ringing' || activeCall.status === 'active')
  const shouldPreserveCurrentCall =
    hasOngoingCall &&
    (
      activeCall.scope_type === 'call_room' ||
      (activeCall.scope_type === 'chat' && activeCallChatId !== null)
    )

  if (!deferredActiveChatId) {
    return shouldPreserveCurrentCall ? { kind: 'preserve_current' } : { kind: 'reset_all' }
  }

  const rawChatId = getRawChatId(deferredActiveChatId)

  if (!rawChatId) {
    return shouldPreserveCurrentCall ? { kind: 'preserve_current' } : { kind: 'clear_current' }
  }

  const shouldPreserveDifferentChatCall =
    hasOngoingCall &&
    (
      activeCall?.scope_type === 'call_room' ||
      (
        activeCall?.scope_type === 'chat' &&
        (
          (activeCallChatId !== null && activeCallChatId !== deferredActiveChatId) ||
          (activeCall.chat_id !== null && activeCall.chat_id !== rawChatId)
        )
      )
    )

  if (shouldPreserveDifferentChatCall) {
    return { kind: 'preserve_other_chat' }
  }

  return { kind: 'load', rawChatId }
}

export async function loadChatScopedActiveCall(
  token: string,
  rawChatId: string,
  deferredActiveChatId: string,
  chatItems: MergedChatSummary[],
  fetchActiveCall: (token: string, rawChatId: string) => Promise<{ call: CallSession | null }>
): Promise<{
  call: CallSession | null
  activeCallChatId: string | null
  displayTitle: string | null
}> {
  const response = await fetchActiveCall(token, rawChatId)

  return {
    call: response.call,
    activeCallChatId: response.call ? deferredActiveChatId : null,
    displayTitle: response.call
      ? (chatItems.find((chat) => chat.id === deferredActiveChatId)?.title ?? null)
      : null
  }
}

export type LoadedCallStateSnapshot = {
  participants: CallParticipant[]
  signals: CallSignal[]
  room: CallRoomState | null
  activeCallRoom: CallRoom | null
  activeCallRoomMembers: CallRoomMember[]
  displayTitle: string | null
  endpoint: CallWebRtcEndpointState
}

export async function loadCallStateSnapshot(options: {
  token: string
  call: CallSession
  activeCallChatId: string | null
  chatItems: MergedChatSummary[]
  fetchCallState: (token: string, callId: string) => Promise<{
    call: CallSession
    participants: CallParticipant[]
    signals: CallSignal[]
    room: CallRoomState | null
  }>
  fetchCallRoom: (token: string, roomId: string) => Promise<{
    room: CallRoom
    members: CallRoomMember[]
  }>
  fetchCallWebRtcEndpointState: (token: string, callId: string) => Promise<{
    endpoint: CallWebRtcEndpointState
    room: CallRoomState | null
  }>
  findMatchingCallChat: (chatItems: MergedChatSummary[], call: CallSession) => MergedChatSummary | null
}): Promise<LoadedCallStateSnapshot> {
  const {
    token,
    call,
    activeCallChatId,
    chatItems,
    fetchCallState,
    fetchCallRoom,
    fetchCallWebRtcEndpointState,
    findMatchingCallChat
  } = options

  const response = await fetchCallState(token, call.id)

  let activeCallRoom: CallRoom | null = null
  let activeCallRoomMembers: CallRoomMember[] = []
  let displayTitle: string | null = null

  if (response.call.scope_type === 'call_room' && response.call.call_room_id) {
    const roomResponse = await fetchCallRoom(token, response.call.call_room_id)
    activeCallRoom = roomResponse.room
    activeCallRoomMembers = roomResponse.members
    displayTitle = roomResponse.room.title
  } else {
    const matchedChat =
      activeCallChatId
        ? chatItems.find((chat) => chat.id === activeCallChatId) ?? null
        : findMatchingCallChat(chatItems, response.call)
    displayTitle = matchedChat?.title ?? null
  }

  const endpointResponse = await fetchCallWebRtcEndpointState(token, call.id)

  return {
    participants: response.participants,
    signals: response.signals,
    room: endpointResponse.room ?? response.room,
    activeCallRoom,
    activeCallRoomMembers,
    displayTitle,
    endpoint: endpointResponse.endpoint
  }
}
