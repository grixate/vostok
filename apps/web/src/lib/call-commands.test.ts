import { describe, expect, it, vi } from 'vitest'
import {
  joinExistingCallSession,
  leaveExistingCallSession,
  startAdHocCallSession,
  startChatCallSession,
  summarizeBootstrapSuccess
} from './call-commands.ts'
import type {
  CallParticipant,
  CallRoom,
  CallRoomMember,
  CallRoomState,
  CallSession,
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
    status: 'ringing',
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

function buildRoom(overrides: Partial<CallRoom> = {}): CallRoom {
  return {
    id: 'room-1',
    title: 'Design Review',
    created_by_user_id: 'user-self',
    expires_at: null,
    closed_at: null,
    ...overrides
  }
}

function buildRoomMember(overrides: Partial<CallRoomMember> = {}): CallRoomMember {
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

function buildParticipant(overrides: Partial<CallParticipant> = {}): CallParticipant {
  return {
    id: 'participant-1',
    call_id: 'call-1',
    user_id: 'user-self',
    username: 'jamie',
    display_name: 'Jamie',
    device_id: 'device-self',
    status: 'joined',
    track_kind: 'audio_video',
    e2ee_capable: true,
    e2ee_algorithm: 'sframe-aes-gcm-v1',
    e2ee_key_epoch: 1,
    joined_at: '2026-04-01T09:31:00Z',
    left_at: null,
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

describe('call-commands', () => {
  it('starts direct and group chat calls with the expected payloads', async () => {
    const createCallSession = vi.fn(async (_token: string, _chatId: string, payload: { mode: 'voice' | 'video' | 'group'; media_mode?: 'voice' | 'video' }) => ({
      call: buildCall({
        mode: payload.mode,
        media_mode: payload.mode === 'group' ? (payload.media_mode ?? 'voice') : payload.mode
      })
    }))

    const direct = await startChatCallSession(
      'token',
      'chat-1',
      'server-1::chat-1',
      buildChat(),
      'video',
      createCallSession
    )
    const group = await startChatCallSession(
      'token',
      'chat-1',
      'server-1::chat-1',
      buildChat({ type: 'group', title: 'Design' }),
      'group',
      createCallSession
    )

    expect(direct.call.mode).toBe('video')
    expect(direct.displayTitle).toBe('Alex')
    expect(group.call.mode).toBe('group')
    expect(group.call.media_mode).toBe('voice')
    expect(group.message).toContain('group call session is ringing')
  })

  it('creates ad-hoc room calls and returns room metadata', async () => {
    const result = await startAdHocCallSession(
      'token',
      ['user-2', 'user-3'],
      'video',
      'Design Review',
      vi.fn(async () => ({ room: buildRoom(), members: [buildRoomMember()] })),
      vi.fn(async () => ({ call: buildCall({ scope_type: 'call_room', scope_id: 'room-1', call_room_id: 'room-1', mode: 'group', media_mode: 'video' }) }))
    )

    expect(result.call.scope_type).toBe('call_room')
    expect(result.room.id).toBe('room-1')
    expect(result.members).toHaveLength(1)
    expect(result.message).toContain('video group call room is ringing')
  })

  it('joins group calls without a pre-existing key epoch (Signal v1)', async () => {
    const joined = await joinExistingCallSession({
      sessionToken: 'token',
      activeCall: buildCall({ mode: 'group', media_mode: 'video', status: 'active' }),
      buildJoinPayload: vi.fn(() => ({
        track_kind: 'audio_video' as const,
        e2ee_capable: true,
        e2ee_algorithm: 'signal-v1'
      })),
      joinCallSession: vi.fn(async () => ({
        participants: [buildParticipant()],
        room: buildRoomState()
      })),
      fetchCallWebRtcEndpointState: vi.fn(async () => ({
        endpoint: buildEndpoint(),
        room: buildRoomState()
      }))
    })

    expect('message' in joined).toBe(true)
  })

  it('joins and leaves active calls with endpoint hydration', async () => {
    const joined = await joinExistingCallSession({
      sessionToken: 'token',
      activeCall: buildCall({ status: 'active', mode: 'group', media_mode: 'video' }),
      buildJoinPayload: vi.fn(() => ({
        track_kind: 'audio_video' as const,
        e2ee_capable: true,
        e2ee_algorithm: 'signal-v1'
      })),
      joinCallSession: vi.fn(async () => ({
        participants: [buildParticipant()],
        room: buildRoomState()
      })),
      fetchCallWebRtcEndpointState: vi.fn(async () => ({
        endpoint: buildEndpoint(),
        room: buildRoomState({ participant_count: 3 })
      }))
    })

    expect('message' in joined && joined.message).toContain('Joined the Membrane room')
    if ('message' in joined) {
      expect(joined.room?.participant_count).toBe(3)
      expect(joined.endpoint.endpoint_id).toBe('endpoint-1')
    }

    const left = await leaveExistingCallSession(
      'token',
      buildCall({ status: 'active' }),
      vi.fn(async () => ({
        participants: [buildParticipant({ status: 'left' })],
        room: buildRoomState()
      })),
      vi.fn(async () => ({
        endpoint: buildEndpoint({ pending_media_event_count: 1 }),
        room: buildRoomState({ participant_count: 1 })
      }))
    )

    expect(left.message).toBe('Left the active Membrane room.')
    expect(left.room?.participant_count).toBe(1)
  })

  it('adds a success message to bootstrap transport summaries', () => {
    const result = summarizeBootstrapSuccess({
      turnCredentials: null,
      participants: null,
      room: buildRoomState(),
      endpoint: buildEndpoint(),
      membraneConnectRequestedCallId: 'call-1'
    })

    expect(result.message).toContain('initialized and connected')
    expect(result.endpoint.endpoint_id).toBe('endpoint-1')
  })
})
