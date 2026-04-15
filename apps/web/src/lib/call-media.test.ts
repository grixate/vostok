import { describe, expect, it } from 'vitest'
import {
  buildJoinPayload,
  computeNextCallKeyEpoch,
  latestCallKeyForDevice,
  parseMediaSignal,
  preferredTrackKind,
  selectLatestCallKey
} from './call-media.ts'
import type { CallKeyDistribution, CallSession } from './api.ts'

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

describe('call-media', () => {
  it('derives audio-video track preference for video calls', () => {
    expect(preferredTrackKind(buildCall({ mode: 'video', media_mode: 'video' }))).toBe('audio_video')
    expect(preferredTrackKind(buildCall({ mode: 'group', media_mode: 'video' }))).toBe('audio_video')
  })

  it('selects the latest key epoch', () => {
    const latest = selectLatestCallKey([
      buildKey({ id: 'key-1', key_epoch: 1 }),
      buildKey({ id: 'key-2', key_epoch: 3 }),
      buildKey({ id: 'key-3', key_epoch: 2 })
    ])

    expect(latest?.id).toBe('key-2')
  })

  it('filters call keys to the active device for group calls', () => {
    const latest = latestCallKeyForDevice(
      buildCall({ mode: 'group', media_mode: 'voice' }),
      [
        buildKey({ id: 'key-1', key_epoch: 1, recipient_device_id: 'device-self' }),
        buildKey({ id: 'key-2', key_epoch: 4, owner_device_id: 'device-self' }),
        buildKey({ id: 'key-3', key_epoch: 5, owner_device_id: 'device-other', recipient_device_id: 'device-another' })
      ],
      'device-self'
    )

    expect(latest?.id).toBe('key-2')
  })

  it('computes the next call key epoch', () => {
    expect(computeNextCallKeyEpoch([buildKey({ key_epoch: 2 }), buildKey({ key_epoch: 7 })])).toBe(8)
  })

  it('builds join payloads that advertise signal-based media encryption', () => {
    expect(buildJoinPayload(buildCall({ mode: 'voice' }), null)).toEqual({
      track_kind: 'audio',
      e2ee_capable: true,
      e2ee_algorithm: 'signal-v2'
    })

    expect(buildJoinPayload(buildCall({ mode: 'group', media_mode: 'video' }), buildKey({ key_epoch: 4 }))).toEqual({
      track_kind: 'audio_video',
      e2ee_capable: true,
      e2ee_algorithm: 'signal-v2'
    })
  })

  it('parses supported media signaling payloads and ignores invalid ones', () => {
    expect(parseMediaSignal(JSON.stringify({ kind: 'media_e2ee_key', public_key: 'abc' }))).toEqual({
      kind: 'media_e2ee_key',
      public_key: 'abc'
    })
    expect(parseMediaSignal(JSON.stringify({ kind: 'media_e2ee_ready', fingerprint: 'fp' }))).toEqual({
      kind: 'media_e2ee_ready',
      fingerprint: 'fp'
    })
    expect(parseMediaSignal('not-json')).toBeNull()
  })
})
