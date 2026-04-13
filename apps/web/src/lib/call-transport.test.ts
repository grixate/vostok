import { describe, expect, it } from 'vitest'
import {
  canBootstrapCallTransport,
  deriveTurnRefreshDelay,
  findRemoteMediaKeySignal,
  hasMatchingRemoteReadySignal,
  isParticipantJoined,
  shouldAttachLocalTracks,
  shouldPollMembraneEndpoint,
  shouldSyncDirectMediaEncryption
} from './call-transport.ts'
import { parseMediaSignal } from './call-media.ts'
import type { CallParticipant, CallSession, TurnCredentials } from './api.ts'

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

describe('call-transport', () => {
  it('gates transport bootstrap to active chat calls with session and device state', () => {
    expect(canBootstrapCallTransport({
      activeCall: buildCall(),
      sessionToken: 'token',
      storedDeviceId: 'device-self',
      view: 'chat'
    })).toBe(true)

    expect(canBootstrapCallTransport({
      activeCall: buildCall({ status: 'ringing' }),
      sessionToken: 'token',
      storedDeviceId: 'device-self',
      view: 'chat'
    })).toBe(false)
  })

  it('detects whether the local device has already joined', () => {
    expect(isParticipantJoined([buildParticipant()], 'device-self')).toBe(true)
    expect(isParticipantJoined([buildParticipant()], 'device-other')).toBe(false)
  })

  it('derives TURN refresh delays from the credential expiry', () => {
    const turn: TurnCredentials = {
      username: 'user',
      password: 'pw',
      ttl_seconds: 600,
      expires_at: new Date(1_000_000).toISOString(),
      uris: ['turn:example.test']
    }

    expect(deriveTurnRefreshDelay(turn, 100_000)).toBeGreaterThan(5_000)
    expect(deriveTurnRefreshDelay(null)).toBeNull()
  })

  it('gates polling and local-track attachment on the required runtime state', () => {
    expect(shouldPollMembraneEndpoint({
      activeCall: buildCall(),
      sessionToken: 'token',
      view: 'chat',
      endpointExists: true
    })).toBe(true)

    expect(shouldAttachLocalTracks({
      activeCall: buildCall(),
      sessionToken: 'token',
      view: 'chat',
      membraneClientConnected: true,
      hasMembraneClient: true,
      hasLocalMediaStream: true,
      localTrackIdsAttached: false
    })).toBe(true)

    expect(shouldAttachLocalTracks({
      activeCall: buildCall(),
      sessionToken: 'token',
      view: 'chat',
      membraneClientConnected: false,
      hasMembraneClient: true,
      hasLocalMediaStream: true,
      localTrackIdsAttached: false
    })).toBe(false)
  })

  it('classifies direct-media sync readiness', () => {
    expect(shouldSyncDirectMediaEncryption(buildCall(), true, 'token', true)).toBe('ready')
    expect(shouldSyncDirectMediaEncryption(buildCall(), false, 'token', true)).toBe('disabled')
    expect(shouldSyncDirectMediaEncryption(buildCall(), true, null, true)).toBe('negotiating')
    expect(shouldSyncDirectMediaEncryption(buildCall({ mode: 'group' }), true, 'token', true)).toBe('skip')
  })

  it('finds remote media key and ready signals', () => {
    const signals = [
      {
        from_device_id: 'device-self',
        payload: JSON.stringify({ kind: 'media_e2ee_key', public_key: 'self-key' })
      },
      {
        from_device_id: 'device-peer',
        payload: JSON.stringify({ kind: 'media_e2ee_key', public_key: 'peer-key' })
      },
      {
        from_device_id: 'device-peer',
        payload: JSON.stringify({ kind: 'media_e2ee_ready', fingerprint: 'peer-fp' })
      }
    ]

    expect(findRemoteMediaKeySignal(signals, 'device-self', parseMediaSignal)).toEqual({
      publicKey: 'peer-key'
    })
    expect(hasMatchingRemoteReadySignal(signals, 'device-self', 'peer-fp', parseMediaSignal)).toBe(true)
  })
})
