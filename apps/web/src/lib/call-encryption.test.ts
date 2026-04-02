import { describe, expect, it } from 'vitest'
import {
  buildDirectMediaKeySignalPayload,
  buildDirectMediaReadySignalPayload,
  needsNewDirectMediaKeyPair,
  resolveLocalGeneratedGroupKey,
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
    privateKeyPkcs8Base64: 'priv',
    publicKeyBase64: 'pub',
    encryptionPrivateKeyPkcs8Base64: 'enc-priv',
    encryptionPublicKeyBase64: 'enc-pub',
    signedPrekeyPublicKeyBase64: 'spk-pub',
    signedPrekeyPrivateKeyPkcs8Base64: 'spk-priv',
    signedPrekeys: [],
    oneTimePrekeys: [],
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

  it('resolves locally generated group keys by call and epoch', () => {
    expect(resolveLocalGeneratedGroupKey({ 'call-1': { 2: 'key-material' } }, 'call-1', 2)).toBe('key-material')
    expect(resolveLocalGeneratedGroupKey({}, 'call-1', 2)).toBeNull()
  })

  it('detects when a new direct media key pair is required', () => {
    expect(needsNewDirectMediaKeyPair(null, 'call-1')).toBe(true)
    expect(needsNewDirectMediaKeyPair({ callId: 'call-2', keyPair: {} }, 'call-1')).toBe(true)
    expect(needsNewDirectMediaKeyPair({ callId: 'call-1', keyPair: {} }, 'call-1')).toBe(false)
  })

  it('builds direct media signaling payloads', () => {
    expect(JSON.parse(buildDirectMediaKeySignalPayload('public-key'))).toEqual({
      kind: 'media_e2ee_key',
      public_key: 'public-key'
    })
    expect(JSON.parse(buildDirectMediaReadySignalPayload('fingerprint'))).toEqual({
      kind: 'media_e2ee_ready',
      fingerprint: 'fingerprint'
    })
  })
})
