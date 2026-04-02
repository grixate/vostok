import { describe, expect, it } from 'vitest'
import {
  buildDirectCallStatusLabel,
  deriveDirectCallStatus,
  shouldRefreshTurnCredentials,
  turnCredentialsToIceServers
} from './call-runtime.ts'
import type { CallSession, TurnCredentials } from './api.ts'

function createCall(overrides: Partial<CallSession> = {}): CallSession {
  return {
    id: 'call-1',
    chat_id: 'chat-1',
    call_room_id: null,
    scope_type: 'chat',
    scope_id: 'chat-1',
    started_by_device_id: 'device-a',
    mode: 'voice',
    media_mode: 'voice',
    status: 'ringing',
    started_at: '2026-04-01T00:00:00Z',
    ended_at: null,
    ...overrides
  }
}

function createTurnCredentials(overrides: Partial<TurnCredentials> = {}): TurnCredentials {
  return {
    username: 'user',
    password: 'pass',
    ttl_seconds: 600,
    expires_at: '2026-04-01T01:00:00Z',
    uris: ['turn:turn.example.com:3478?transport=udp'],
    ...overrides
  }
}

describe('deriveDirectCallStatus', () => {
  it('distinguishes outgoing and incoming ringing calls', () => {
    const transportReadiness = {
      localMediaReady: false,
      endpointReady: false,
      turnReady: false,
      membraneConnected: false
    }

    expect(
      deriveDirectCallStatus({
        activeCall: createCall(),
        localDeviceId: 'device-a',
        transportReadiness,
        transportError: null,
        isEnding: false
      })
    ).toBe('ringing_outgoing')

    expect(
      deriveDirectCallStatus({
        activeCall: createCall({ started_by_device_id: 'device-b' }),
        localDeviceId: 'device-a',
        transportReadiness,
        transportError: null,
        isEnding: false
      })
    ).toBe('ringing_incoming')
  })

  it('treats active calls without a ready transport as connecting', () => {
    expect(
      deriveDirectCallStatus({
        activeCall: createCall({ status: 'active', mode: 'video' }),
        localDeviceId: 'device-a',
        transportReadiness: {
          localMediaReady: true,
          endpointReady: true,
          turnReady: true,
          membraneConnected: false
        },
        transportError: null,
        isEnding: false
      })
    ).toBe('connecting')
  })

  it('treats active calls with a ready transport as active', () => {
    expect(
      deriveDirectCallStatus({
        activeCall: createCall({ status: 'active', mode: 'video' }),
        localDeviceId: 'device-a',
        transportReadiness: {
          localMediaReady: true,
          endpointReady: true,
          turnReady: true,
          membraneConnected: true
        },
        transportError: null,
        isEnding: false
      })
    ).toBe('active')
  })

  it('fails closed for transport errors and group calls', () => {
    expect(
      deriveDirectCallStatus({
        activeCall: createCall({ status: 'active' }),
        localDeviceId: 'device-a',
        transportReadiness: {
          localMediaReady: true,
          endpointReady: true,
          turnReady: true,
          membraneConnected: true
        },
        transportError: 'TURN failed',
        isEnding: false
      })
    ).toBe('error')

    expect(
      deriveDirectCallStatus({
        activeCall: createCall({ status: 'active', mode: 'group' }),
        localDeviceId: 'device-a',
        transportReadiness: {
          localMediaReady: true,
          endpointReady: true,
          turnReady: true,
          membraneConnected: true
        },
        transportError: null,
        isEnding: false
      })
    ).toBe('idle')
  })
})

describe('TURN helpers', () => {
  it('refreshes credentials that are missing or expiring soon', () => {
    expect(shouldRefreshTurnCredentials(null)).toBe(true)
    expect(
      shouldRefreshTurnCredentials(
        createTurnCredentials({ expires_at: '2026-04-01T00:00:30Z' }),
        Date.parse('2026-04-01T00:00:00Z')
      )
    ).toBe(true)
    expect(
      shouldRefreshTurnCredentials(
        createTurnCredentials({ expires_at: '2026-04-01T00:10:00Z' }),
        Date.parse('2026-04-01T00:00:00Z')
      )
    ).toBe(false)
  })

  it('converts TURN credentials into RTC ice servers', () => {
    expect(turnCredentialsToIceServers(createTurnCredentials())).toEqual([
      {
        urls: ['turn:turn.example.com:3478?transport=udp'],
        username: 'user',
        credential: 'pass'
      }
    ])
  })
})

describe('buildDirectCallStatusLabel', () => {
  it('uses human-readable labels for milestone states', () => {
    expect(buildDirectCallStatusLabel('ringing_outgoing', 'voice', null)).toBe('Calling…')
    expect(buildDirectCallStatusLabel('connecting', 'video', null)).toBe('Connecting video…')
    expect(buildDirectCallStatusLabel('error', 'voice', 'TURN failed')).toBe('TURN failed')
  })
})
