import { describe, expect, it } from 'vitest'
import {
  shouldSyncGroupMediaEncryption
} from './call-encryption.ts'
import type { CallSession } from './api.ts'
import type { StoredDevice } from '../types.ts'

function buildCall(overrides: Partial<CallSession> = {}): CallSession {
  return {
    id: 'call-1',
    chat_id: 'chat-1',
    call_room_id: null,
    scope_type: 'chat',
    scope_id: 'chat-1',
    started_by_device_id: 'device-self',
    mode: 'group',
    media_mode: 'voice',
    status: 'active',
    started_at: '2026-04-01T09:30:00Z',
    ended_at: null,
    display_title: null,
    ...overrides
  }
}

function buildDevice(): StoredDevice {
  return {
    deviceId: 'device-self',
    deviceName: 'Web',
    registrationId: 12345,
    signedPreKeyIdCounter: 1,
    oneTimePreKeyIdCounter: 17,
    sessionExpiresAt: '2026-04-02T09:00:00Z',
    sessionToken: 'token',
    username: 'jamie'
  }
}

describe('call-encryption', () => {
  it('gates group media sync on active group call readiness', () => {
    expect(shouldSyncGroupMediaEncryption(buildCall(), true, buildDevice(), true)).toBe('ready')
    expect(shouldSyncGroupMediaEncryption(buildCall(), false, buildDevice(), true)).toBe('disabled')
    expect(shouldSyncGroupMediaEncryption(buildCall({ status: 'ringing' }), true, buildDevice(), true)).toBe('skip')
    expect(shouldSyncGroupMediaEncryption(buildCall({ mode: 'video' }), true, buildDevice(), true)).toBe('skip')
  })
})
