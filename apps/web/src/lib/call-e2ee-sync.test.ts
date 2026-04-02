import { describe, expect, it, vi } from 'vitest'
import {
  syncDirectMediaEncryption,
  syncGroupMediaEncryption
} from './call-e2ee-sync.ts'
import type { CallKeyDistribution, CallSession, CallSignal } from './api.ts'
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
    encryptionPrivateKeyPkcs8Base64: 'enc-pkcs8',
    sessionExpiresAt: '2026-04-01T10:30:00Z',
    sessionToken: 'token',
    username: 'jamie',
    ...overrides
  }
}

function buildKey(overrides: Partial<CallKeyDistribution> = {}): CallKeyDistribution {
  return {
    id: 'key-1',
    call_id: 'call-1',
    owner_device_id: 'device-self',
    recipient_device_id: 'device-peer',
    key_epoch: 2,
    algorithm: 'sframe-aes-gcm-v1',
    status: 'active',
    wrapped_key: 'wrapped',
    inserted_at: '2026-04-01T09:30:00Z',
    updated_at: '2026-04-01T09:30:00Z',
    ...overrides
  }
}

describe('call-e2ee-sync', () => {
  it('applies group media keys when the connection is ready', async () => {
    const controller = {}
    const updateControllerKey = vi.fn()
    const attachController = vi.fn()

    const result = await syncGroupMediaEncryption({
      activeCall: buildCall(),
      currentDevice: buildDevice(),
      latestCallKey: buildKey(),
      localGeneratedCallKeys: {},
      resolveLocalGeneratedGroupKey: () => null,
      unwrapWrappedGroupKey: vi.fn(async () => 'group-key'),
      membraneClient: { id: 'membrane' },
      getPeerConnection: () => ({ id: 'pc' }),
      ensureController: () => controller,
      updateControllerKey,
      attachController
    })

    expect(result).toEqual({
      state: 'encrypted',
      fingerprint: null,
      currentKeyEpoch: 2
    })
    expect(updateControllerKey).toHaveBeenCalledWith(controller, 'group-key')
    expect(attachController).toHaveBeenCalledWith(controller, { id: 'pc' })
  })

  it('returns an error state when no group media key can be resolved', async () => {
    const result = await syncGroupMediaEncryption({
      activeCall: buildCall(),
      currentDevice: buildDevice(),
      latestCallKey: buildKey(),
      localGeneratedCallKeys: {},
      resolveLocalGeneratedGroupKey: () => null,
      unwrapWrappedGroupKey: vi.fn(async () => null),
      membraneClient: null,
      getPeerConnection: () => null,
      ensureController: () => ({}),
      updateControllerKey: vi.fn(),
      attachController: vi.fn()
    })

    expect(result.state).toBe('error')
    expect(result.currentKeyEpoch).toBeNull()
  })

  it('generates, exchanges, and verifies direct media encryption state', async () => {
    const controller = {}
    const sendCallSignal = vi.fn(async () => ({}))
    const callSignals: CallSignal[] = [
      {
        id: 'signal-1',
        call_id: 'call-1',
        from_device_id: 'device-peer',
        target_device_id: null,
        signal_type: 'heartbeat',
        payload: JSON.stringify({ kind: 'media_e2ee_key', public_key: 'peer-key' }),
        inserted_at: '2026-04-01T09:31:00Z'
      },
      {
        id: 'signal-2',
        call_id: 'call-1',
        from_device_id: 'device-peer',
        target_device_id: null,
        signal_type: 'heartbeat',
        payload: JSON.stringify({ kind: 'media_e2ee_ready', fingerprint: 'aa:bb:cc' }),
        inserted_at: '2026-04-01T09:31:10Z'
      }
    ]
    const privateKey = {} as CryptoKey

    const result = await syncDirectMediaEncryption({
      activeCall: buildCall({ mode: 'video', media_mode: 'video' }),
      sessionToken: 'token',
      callSignals,
      localDeviceId: 'device-self',
      currentPairEntry: null,
      readySentForCallId: null,
      needsNewDirectMediaKeyPair: () => true,
      generateDirectMediaKeyPair: vi.fn(async () => ({
        publicKeyBase64: 'self-key',
        privateKey
      })),
      sendCallSignal,
      buildDirectMediaKeySignalPayload: (publicKeyBase64) =>
        JSON.stringify({ kind: 'media_e2ee_key', public_key: publicKeyBase64 }),
      findRemoteMediaKeySignal: () => ({ publicKey: 'peer-key' }),
      parseMediaSignal: (payload) => JSON.parse(payload) as { kind: 'media_e2ee_key'; public_key: string } | { kind: 'media_e2ee_ready'; fingerprint: string },
      deriveDirectMediaSharedKey: vi.fn(async () => ({
        keyMaterialBase64: 'shared-key',
        fingerprint: 'aa:bb:cc'
      })),
      membraneClient: { id: 'membrane' },
      getPeerConnection: () => ({ id: 'pc' }),
      ensureController: () => controller,
      updateControllerKey: vi.fn(),
      attachController: vi.fn(),
      buildDirectMediaReadySignalPayload: (fingerprint) =>
        JSON.stringify({ kind: 'media_e2ee_ready', fingerprint }),
      hasMatchingRemoteReadySignal: () => true
    })

    expect(result.state).toBe('verified')
    expect(result.fingerprint).toBe('aa:bb:cc')
    expect(result.currentKeyEpoch).toBe(1)
    expect(result.nextPairEntry?.callId).toBe('call-1')
    expect(result.readySentForCallId).toBe('call-1')
    expect(sendCallSignal).toHaveBeenCalledTimes(2)
  })
})
