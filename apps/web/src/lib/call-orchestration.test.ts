import { describe, expect, it, vi } from 'vitest'
import {
  attachLocalTracks,
  bootstrapActiveCallTransport,
  syncMembraneWebRtcQueue
} from './call-orchestration.ts'
import type {
  CallKeyDistribution,
  CallParticipant,
  CallRoomState,
  CallSession,
  CallWebRtcEndpointState,
  TurnCredentials
} from './api.ts'
import type { StoredDevice } from '../types.ts'

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

function buildDevice(overrides: Partial<StoredDevice> = {}): StoredDevice {
  return {
    deviceId: 'device-self',
    deviceName: 'Laptop',
    privateKeyPkcs8Base64: 'pkcs8',
    publicKeyBase64: 'pub',
    sessionExpiresAt: '2026-04-01T10:30:00Z',
    sessionToken: 'token',
    username: 'jamie',
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

function buildEndpoint(overrides: Partial<CallWebRtcEndpointState> = {}): CallWebRtcEndpointState {
  return {
    exists: true,
    endpoint_id: 'endpoint-1',
    pending_media_event_count: 0,
    ...overrides
  }
}

function buildRoom(overrides: Partial<CallRoomState> = {}): CallRoomState {
  return {
    backend: 'membrane',
    call_id: 'call-1',
    mode: 'video',
    participant_count: 2,
    active_device_ids: ['device-self', 'device-peer'],
    endpoint_count: 1,
    ...overrides
  }
}

function buildTurn(overrides: Partial<TurnCredentials> = {}): TurnCredentials {
  return {
    username: 'turn-user',
    password: 'turn-password',
    ttl_seconds: 600,
    expires_at: '2026-04-01T09:40:00Z',
    uris: ['turn:example.test'],
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

describe('call-orchestration', () => {
  it('refreshes TURN, joins, provisions, and connects the Membrane client', async () => {
    const client = { id: 'membrane-client' }
    const fetchTurnCredentials = vi.fn(async () => ({ turn: buildTurn() }))
    const joinCallSession = vi.fn(async () => ({
      participants: [buildParticipant()],
      room: buildRoom({ participant_count: 1 })
    }))
    const provisionCallWebRtcEndpoint = vi.fn(async () => ({
      endpoint: buildEndpoint(),
      room: buildRoom()
    }))
    const configureMembraneTurnServers = vi.fn()
    const connectMembraneClient = vi.fn()

    const result = await bootstrapActiveCallTransport({
      currentCall: buildCall(),
      currentDevice: buildDevice(),
      currentSessionToken: 'token',
      turnCredentials: null,
      shouldRefreshTurnCredentials: (turn) => turn == null,
      fetchTurnCredentials,
      callParticipants: [],
      isParticipantJoined: () => false,
      latestCallKey: null,
      rotateGroupCallKeysFor: vi.fn(),
      buildJoinPayload: vi.fn(() => ({ track_kind: 'audio_video' as const })),
      joinCallSession,
      currentEndpoint: null,
      currentRoom: null,
      provisionCallWebRtcEndpoint,
      ensureMembraneClient: () => client,
      configureMembraneTurnServers,
      membraneClientConnected: false,
      membraneConnectRequestedCallId: null,
      connectMembraneClient
    })

    expect(fetchTurnCredentials).toHaveBeenCalledWith('token', { ttl_seconds: 600 })
    expect(joinCallSession).toHaveBeenCalledWith('token', 'call-1', { track_kind: 'audio_video' })
    expect(provisionCallWebRtcEndpoint).toHaveBeenCalledWith('token', 'call-1')
    expect(configureMembraneTurnServers).toHaveBeenCalledWith(client, result.turnCredentials)
    expect(connectMembraneClient).toHaveBeenCalledWith(client, expect.objectContaining({
      call_id: 'call-1',
      device_id: 'device-self',
      mode: 'video',
      username: 'jamie'
    }))
    expect(result.participants?.[0]?.device_id).toBe('device-self')
    expect(result.endpoint.endpoint_id).toBe('endpoint-1')
    expect(result.room?.call_id).toBe('call-1')
    expect(result.membraneConnectRequestedCallId).toBe('call-1')
  })

  it('rotates group keys for the call owner before joining when the epoch is missing', async () => {
    const rotatedKeys = [buildKey({ key_epoch: 4 })]
    const buildJoinPayload = vi.fn(() => ({
      track_kind: 'audio' as const,
      e2ee_capable: true,
      e2ee_algorithm: 'sframe-aes-gcm-v1',
      e2ee_key_epoch: 4
    }))

    await bootstrapActiveCallTransport({
      currentCall: buildCall({ mode: 'group', media_mode: 'voice' }),
      currentDevice: buildDevice(),
      currentSessionToken: 'token',
      turnCredentials: buildTurn(),
      shouldRefreshTurnCredentials: () => false,
      fetchTurnCredentials: vi.fn(),
      callParticipants: [],
      isParticipantJoined: () => false,
      latestCallKey: null,
      rotateGroupCallKeysFor: vi.fn(async () => rotatedKeys),
      buildJoinPayload,
      joinCallSession: vi.fn(async () => ({
        participants: [buildParticipant({ track_kind: 'audio' })],
        room: buildRoom()
      })),
      currentEndpoint: buildEndpoint(),
      currentRoom: buildRoom(),
      provisionCallWebRtcEndpoint: vi.fn(),
      ensureMembraneClient: () => ({}),
      configureMembraneTurnServers: vi.fn(),
      membraneClientConnected: true,
      membraneConnectRequestedCallId: 'call-1',
      connectMembraneClient: vi.fn()
    })

    expect(buildJoinPayload).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'group' }),
      expect.objectContaining({ key_epoch: 4 })
    )
  })

  it('reuses the existing endpoint and skips connect when the client is already connected', async () => {
    const provisionCallWebRtcEndpoint = vi.fn()
    const connectMembraneClient = vi.fn()

    const result = await bootstrapActiveCallTransport({
      currentCall: buildCall(),
      currentDevice: buildDevice(),
      currentSessionToken: 'token',
      turnCredentials: buildTurn(),
      shouldRefreshTurnCredentials: () => false,
      fetchTurnCredentials: vi.fn(),
      callParticipants: [buildParticipant()],
      isParticipantJoined: () => true,
      latestCallKey: null,
      rotateGroupCallKeysFor: vi.fn(),
      buildJoinPayload: vi.fn(),
      joinCallSession: vi.fn(),
      currentEndpoint: buildEndpoint({ endpoint_id: 'endpoint-existing' }),
      currentRoom: buildRoom({ participant_count: 4 }),
      provisionCallWebRtcEndpoint,
      ensureMembraneClient: () => ({}),
      configureMembraneTurnServers: vi.fn(),
      membraneClientConnected: true,
      membraneConnectRequestedCallId: 'call-1',
      connectMembraneClient
    })

    expect(provisionCallWebRtcEndpoint).not.toHaveBeenCalled()
    expect(connectMembraneClient).not.toHaveBeenCalled()
    expect(result.participants).toBeNull()
    expect(result.endpoint.endpoint_id).toBe('endpoint-existing')
    expect(result.room?.participant_count).toBe(4)
    expect(result.membraneConnectRequestedCallId).toBe('call-1')
  })

  it('delegates endpoint polling and local-track attachment', async () => {
    const poll = vi.fn(async () => ({
      endpoint: buildEndpoint(),
      media_events: ['event-1', 'event-2']
    }))
    const attach = vi.fn(async () => ['track-1', 'track-2'])
    const localStream = {} as MediaStream

    const queue = await syncMembraneWebRtcQueue('token', 'call-1', poll)
    const trackIds = await attachLocalTracks({}, localStream, attach)

    expect(queue).toEqual({
      endpoint: expect.objectContaining({ endpoint_id: 'endpoint-1' }),
      mediaEvents: ['event-1', 'event-2']
    })
    expect(trackIds).toEqual(['track-1', 'track-2'])
    expect(attach).toHaveBeenCalledWith({}, localStream)
  })
})
