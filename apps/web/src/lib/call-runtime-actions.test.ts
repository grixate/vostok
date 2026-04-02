import { describe, expect, it, vi } from 'vitest'
import {
  acceptIncomingCall,
  buildEndpointPingMetadata,
  declineIncomingCall,
  endActiveCallSession,
  performUnloadCallCleanup,
  pollManualWebRtcEndpoint,
  provisionManualWebRtcEndpoint
} from './call-runtime-actions.ts'
import type { CallRoomState, CallSession, CallWebRtcEndpointState } from './api.ts'

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

function buildEndpoint(overrides: Partial<CallWebRtcEndpointState> = {}): CallWebRtcEndpointState {
  return {
    endpoint_id: 'endpoint-1',
    exists: true,
    pending_media_event_count: 0,
    ...overrides
  }
}

function buildRoom(overrides: Partial<CallRoomState> = {}): CallRoomState {
  return {
    backend: 'membrane',
    call_id: 'call-1',
    mode: 'voice',
    participant_count: 2,
    active_device_ids: ['device-self', 'device-peer'],
    ...overrides
  }
}

describe('call-runtime-actions', () => {
  it('wraps accept/decline/end mutations into UI-friendly results', async () => {
    const accepted = await acceptIncomingCall(
      'token',
      'call-1',
      vi.fn(async () => ({ call: buildCall({ status: 'active' }) }))
    )
    const declined = await declineIncomingCall(
      'token',
      'call-1',
      'server-1::chat-1',
      vi.fn(async () => ({ call: buildCall({ status: 'ended' }) }))
    )
    const ended = await endActiveCallSession(
      'token',
      'call-1',
      'server-1::chat-1',
      vi.fn(async () => ({ call: buildCall({ status: 'ended' }) }))
    )

    expect(accepted.message).toBe('Call accepted.')
    expect(declined.call).toBeNull()
    expect(declined.activeCallChatId).toBeNull()
    expect(ended.call).toBeNull()
    expect(ended.message).toBe('Call session ended.')
  })

  it('wraps manual endpoint provision and queue polling', async () => {
    const provisioned = await provisionManualWebRtcEndpoint(
      'token',
      'call-1',
      vi.fn(async () => ({ endpoint: buildEndpoint(), room: buildRoom() }))
    )
    const polled = await pollManualWebRtcEndpoint(
      'token',
      'call-1',
      vi.fn(async () => ({
        endpoint: buildEndpoint(),
        mediaEvents: ['native:foo', JSON.stringify({ type: 'offer' })]
      })),
      vi.fn()
    )

    expect(provisioned.message).toContain('endpoint ready')
    expect(polled.mediaEvents).toHaveLength(2)
    expect(polled.message).toContain('Polled 2 outbound Membrane media events')
  })

  it('builds endpoint ping metadata and performs unload cleanup', async () => {
    const metadata = buildEndpointPingMetadata(buildCall({ mode: 'video' }))
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }))
    const stop = vi.fn()

    await performUnloadCallCleanup(
      {} as MediaStream,
      stop,
      buildCall(),
      'token',
      'https://example.test',
      fetchImpl as typeof fetch
    )

    expect(metadata.mode).toBe('video')
    expect(metadata.source).toBe('web-client')
    expect(stop).toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/api/v1/calls/call-1/end',
      expect.objectContaining({ method: 'POST', keepalive: true })
    )
  })
})
