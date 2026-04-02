import type { CallSession } from './api.ts'
import type { MergedChatSummary } from './multi-server.ts'

export type ActiveCallDiscoverySnapshot = {
  activeCall: CallSession | null
  activeCallChatId: string | null
  activeCallRoomId: string | null
  activeCallRoomMemberCount: number
  activeCallDisplayTitle: string | null
}

export type ActiveCallDiscoveryResolution = {
  matchingChat: MergedChatSummary | null
  nextChatId: string | null
  nextDisplayTitle: string | null
  requiresRoomFetch: boolean
  matchesCurrentCall: boolean
}

export function findMatchingCallChat(
  chatItems: MergedChatSummary[],
  call: CallSession | null
): MergedChatSummary | null {
  if (!call || call.scope_type !== 'chat' || !call.chat_id) {
    return null
  }

  return chatItems.find((chat) => chat.rawId === call.chat_id) ?? null
}

export function resolveChatCallDisplayTitle(
  call: CallSession | null,
  matchingChat: MergedChatSummary | null,
  fallbackTitle: string | null
): string | null {
  if (!call) {
    return null
  }

  if (call.scope_type === 'chat') {
    return call.display_title ?? matchingChat?.title ?? null
  }

  return call.display_title ?? fallbackTitle
}

export function resolveActiveCallDiscovery(
  nextCall: CallSession,
  chatItems: MergedChatSummary[],
  snapshot: ActiveCallDiscoverySnapshot
): ActiveCallDiscoveryResolution {
  const matchingChat = findMatchingCallChat(chatItems, nextCall)
  const nextChatId = matchingChat?.id ?? null
  const nextDisplayTitle = resolveChatCallDisplayTitle(
    nextCall,
    matchingChat,
    snapshot.activeCallDisplayTitle
  )

  const requiresScopeRefresh =
    nextCall.scope_type === 'chat'
      ? snapshot.activeCallChatId !== nextChatId ||
        snapshot.activeCallRoomId !== null ||
        snapshot.activeCallRoomMemberCount > 0 ||
        snapshot.activeCallDisplayTitle !== nextDisplayTitle
      : snapshot.activeCallChatId !== null ||
        snapshot.activeCallRoomId !== nextCall.call_room_id ||
        snapshot.activeCallRoomMemberCount === 0

  const matchesCurrentCall =
    snapshot.activeCall != null &&
    snapshot.activeCall.id === nextCall.id &&
    snapshot.activeCall.status === nextCall.status &&
    snapshot.activeCall.scope_type === nextCall.scope_type &&
    snapshot.activeCall.chat_id === nextCall.chat_id &&
    snapshot.activeCall.call_room_id === nextCall.call_room_id &&
    !requiresScopeRefresh &&
    snapshot.activeCallDisplayTitle === nextDisplayTitle

  return {
    matchingChat,
    nextChatId,
    nextDisplayTitle,
    requiresRoomFetch: nextCall.scope_type === 'call_room' && Boolean(nextCall.call_room_id),
    matchesCurrentCall
  }
}
