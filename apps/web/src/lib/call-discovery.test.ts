import { describe, expect, it } from 'vitest'
import {
  findMatchingCallChat,
  resolveActiveCallDiscovery,
  resolveChatCallDisplayTitle,
  type ActiveCallDiscoverySnapshot
} from './call-discovery.ts'
import type { CallSession } from './api.ts'
import type { MergedChatSummary } from './multi-server.ts'

function buildChat(overrides: Partial<MergedChatSummary> = {}): MergedChatSummary {
  return {
    id: 'srv::chat-1',
    rawId: 'chat-1',
    serverId: 'srv',
    qualifiedId: 'srv::chat-1',
    serverLabel: 'Server',
    serverColor: '#008BFF',
    serverUrl: 'https://example.test',
    type: 'direct' as const,
    title: 'Casey',
    participant_usernames: ['jamie', 'casey'],
    participant_user_ids: ['user-self', 'user-casey'],
    is_self_chat: false,
    latest_message_at: '2026-04-01T09:00:00Z',
    message_count: 0,
    ...overrides
  }
}

function buildCall(overrides: Partial<CallSession> = {}): CallSession {
  return {
    id: 'call-1',
    chat_id: 'chat-1',
    call_room_id: null,
    scope_type: 'chat',
    scope_id: 'chat-1',
    started_by_device_id: 'device-self',
    mode: 'video',
    media_mode: 'video',
    status: 'active',
    started_at: '2026-04-01T09:30:00Z',
    ended_at: null,
    display_title: null,
    ...overrides
  }
}

function buildSnapshot(overrides: Partial<ActiveCallDiscoverySnapshot> = {}): ActiveCallDiscoverySnapshot {
  return {
    activeCall: null,
    activeCallChatId: null,
    activeCallRoomId: null,
    activeCallRoomMemberCount: 0,
    activeCallDisplayTitle: null,
    ...overrides
  }
}

describe('call-discovery', () => {
  it('finds the matching merged chat for a chat-scoped call', () => {
    const chat = buildChat()
    expect(findMatchingCallChat([chat], buildCall())).toEqual(chat)
  })

  it('resolves the chat display title from a matching chat when the call has no explicit title', () => {
    expect(resolveChatCallDisplayTitle(buildCall(), buildChat(), null)).toBe('Casey')
  })

  it('detects when a discovered chat call already matches the current active call snapshot', () => {
    const call = buildCall()
    const chat = buildChat()
    const snapshot = buildSnapshot({
      activeCall: call,
      activeCallChatId: chat.id,
      activeCallDisplayTitle: 'Casey'
    })

    expect(resolveActiveCallDiscovery(call, [chat], snapshot)).toEqual({
      matchingChat: chat,
      nextChatId: chat.id,
      nextDisplayTitle: 'Casey',
      requiresRoomFetch: false,
      matchesCurrentCall: true
    })
  })

  it('requests a scope refresh when a room-backed call replaces a chat-backed snapshot', () => {
    const nextCall = buildCall({
      scope_type: 'call_room',
      scope_id: 'room-1',
      chat_id: null,
      call_room_id: 'room-1',
      mode: 'group',
      media_mode: 'voice'
    })
    const snapshot = buildSnapshot({
      activeCall: buildCall(),
      activeCallChatId: 'srv::chat-1',
      activeCallDisplayTitle: 'Casey'
    })

    expect(resolveActiveCallDiscovery(nextCall, [buildChat()], snapshot)).toEqual({
      matchingChat: null,
      nextChatId: null,
      nextDisplayTitle: 'Casey',
      requiresRoomFetch: true,
      matchesCurrentCall: false
    })
  })

  it('treats display-title changes as a required refresh even when the call id is unchanged', () => {
    const call = buildCall({ display_title: 'Casey Direct' })
    const chat = buildChat()
    const snapshot = buildSnapshot({
      activeCall: { ...call, display_title: null },
      activeCallChatId: chat.id,
      activeCallDisplayTitle: 'Casey'
    })

    const resolution = resolveActiveCallDiscovery(call, [chat], snapshot)
    expect(resolution.matchesCurrentCall).toBe(false)
    expect(resolution.nextDisplayTitle).toBe('Casey Direct')
  })
})
