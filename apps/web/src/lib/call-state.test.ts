import { describe, expect, it, vi } from 'vitest'
import {
  loadCallStateSnapshot,
  loadChatScopedActiveCall,
  resolveChatScopedActiveCallDecision
} from './call-state.ts'
import type {
  CallKeyDistribution,
  CallParticipant,
  CallRoom,
  CallRoomMember,
  CallRoomState,
  CallSession,
  CallSignal,
  CallWebRtcEndpointState
} from './api.ts'
import type { MergedChatSummary } from './multi-server.ts'

function buildCall(overrides: Partial<CallSession> = {}): CallSession {
  return {
    id: 'call-1',
    chat_id: 'chat-1',
    call_room_id: null,
    scope_type: 'chat',
    scope_id: 'chat-1',
    started_by_device_id: 'device-self',
    mode: 'voice',
    media_mode: 'voice',
    status: 'active',
    started_at: '2026-04-01T09:30:00Z',
    ended_at: null,
    display_title: null,
    ...overrides
  }
}

function buildChat(overrides: Partial<MergedChatSummary> = {}): MergedChatSummary {
  return {
    id: 'server-1::chat-1',
    rawId: 'chat-1',
    serverId: 'server-1',
    qualifiedId: 'server-1::chat-1',
    serverLabel: 'Primary',
    serverColor: '#3366ff',
    serverUrl: 'https://example.test',
    type: 'direct',
    title: 'Alex',
    participant_usernames: ['alex'],
    participant_user_ids: ['user-2'],
    is_self_chat: false,
    latest_message_at: null,
    message_count: 0,
    ...overrides
  }
}

function buildParticipant(overrides: Partial<CallParticipant> = {}): CallParticipant {
  return {
    id: 'participant-1',
    call_id: 'call-1',
    user_id: 'user-self',
    username: 'jamie',
    display_name: 'Jamie',
    device_id: 'device-self',
    status: 'joined',
    track_kind: 'audio',
    e2ee_capable: true,
    e2ee_algorithm: 'sframe-aes-gcm-v1',
    e2ee_key_epoch: 1,
    joined_at: '2026-04-01T09:31:00Z',
    left_at: null,
    ...overrides
  }
}

function buildSignal(overrides: Partial<CallSignal> = {}): CallSignal {
  return {
    id: 'signal-1',
    call_id: 'call-1',
    from_device_id: 'device-peer',
    target_device_id: null,
    signal_type: 'heartbeat',
    payload: '{}',
    inserted_at: '2026-04-01T09:32:00Z',
    ...overrides
  }
}

function buildRoomState(overrides: Partial<CallRoomState> = {}): CallRoomState {
  return {
    backend: 'membrane',
    call_id: 'call-1',
    mode: 'voice',
    participant_count: 2,
    active_device_ids: ['device-self', 'device-peer'],
    ...overrides
  }
}

function buildEndpoint(overrides: Partial<CallWebRtcEndpointState> = {}): CallWebRtcEndpointState {
  return {
    endpoint_id: 'endpoint-1',
    exists: true,
    pending_media_event_count: 0,
    ...overrides
  }
}

function buildCallRoom(overrides: Partial<CallRoom> = {}): CallRoom {
  return {
    id: 'room-1',
    title: 'Design Review',
    created_by_user_id: 'user-self',
    expires_at: null,
    closed_at: null,
    ...overrides
  }
}

function buildCallRoomMember(overrides: Partial<CallRoomMember> = {}): CallRoomMember {
  return {
    id: 'member-1',
    user_id: 'user-self',
    username: 'jamie',
    display_name: 'Jamie',
    role: 'owner',
    joined_at: '2026-04-01T09:30:00Z',
    ...overrides
  }
}

function buildKey(overrides: Partial<CallKeyDistribution> = {}): CallKeyDistribution {
  return {
    id: 'key-1',
    call_id: 'call-1',
    owner_device_id: 'device-self',
    recipient_device_id: 'device-peer',
    key_epoch: 1,
    algorithm: 'sframe-aes-gcm-v1',
    status: 'active',
    wrapped_key: 'wrapped',
    inserted_at: '2026-04-01T09:30:00Z',
    updated_at: '2026-04-01T09:30:00Z',
    ...overrides
  }
}

describe('call-state', () => {
  it('preserves calls that belong to a different chat or room', () => {
    const decision = resolveChatScopedActiveCallDecision(
      buildCall({ chat_id: 'chat-2', scope_id: 'chat-2' }),
      'server-1::chat-2',
      'server-1::chat-1',
      (chatId) => (chatId ? chatId.split('::')[1] ?? null : null)
    )

    expect(decision).toEqual({ kind: 'preserve_other_chat' })
  })

  it('loads the current chat-scoped active call when the selected chat matches', async () => {
    const result = await loadChatScopedActiveCall(
      'token',
      'chat-1',
      'server-1::chat-1',
      [buildChat()],
      vi.fn(async () => ({ call: buildCall() }))
    )

    expect(result).toEqual({
      call: expect.objectContaining({ id: 'call-1' }),
      activeCallChatId: 'server-1::chat-1',
      displayTitle: 'Alex'
    })
  })

  it('hydrates room-backed call state with room members and title', async () => {
    const snapshot = await loadCallStateSnapshot({
      token: 'token',
      call: buildCall({
        scope_type: 'call_room',
        scope_id: 'room-1',
        call_room_id: 'room-1',
        mode: 'group',
        media_mode: 'video'
      }),
      activeCallChatId: null,
      chatItems: [buildChat()],
      fetchCallState: vi.fn(async () => ({
        call: buildCall({
          scope_type: 'call_room',
          scope_id: 'room-1',
          call_room_id: 'room-1',
          mode: 'group',
          media_mode: 'video'
        }),
        participants: [buildParticipant()],
        signals: [buildSignal()],
        room: buildRoomState()
      })),
      fetchCallRoom: vi.fn(async () => ({
        room: buildCallRoom(),
        members: [buildCallRoomMember()]
      })),
      fetchCallKeys: vi.fn(async () => ({ keys: [buildKey()] })),
      fetchCallWebRtcEndpointState: vi.fn(async () => ({
        endpoint: buildEndpoint(),
        room: buildRoomState({ participant_count: 3 })
      })),
      findMatchingCallChat: vi.fn(() => null)
    })

    expect(snapshot.displayTitle).toBe('Design Review')
    expect(snapshot.activeCallRoom?.id).toBe('room-1')
    expect(snapshot.activeCallRoomMembers).toHaveLength(1)
    expect(snapshot.callKeys).toHaveLength(1)
    expect(snapshot.room?.participant_count).toBe(3)
  })

  it('hydrates chat-backed call state without fetching room metadata', async () => {
    const fetchCallRoom = vi.fn()
    const snapshot = await loadCallStateSnapshot({
      token: 'token',
      call: buildCall(),
      activeCallChatId: 'server-1::chat-1',
      chatItems: [buildChat({ title: 'Jordan' })],
      fetchCallState: vi.fn(async () => ({
        call: buildCall(),
        participants: [buildParticipant()],
        signals: [],
        room: buildRoomState()
      })),
      fetchCallRoom,
      fetchCallKeys: vi.fn(async () => ({ keys: [] })),
      fetchCallWebRtcEndpointState: vi.fn(async () => ({
        endpoint: buildEndpoint(),
        room: null
      })),
      findMatchingCallChat: vi.fn(() => null)
    })

    expect(fetchCallRoom).not.toHaveBeenCalled()
    expect(snapshot.displayTitle).toBe('Jordan')
    expect(snapshot.activeCallRoom).toBeNull()
    expect(snapshot.activeCallRoomMembers).toEqual([])
    expect(snapshot.callKeys).toEqual([])
  })
})
