import { afterEach, describe, expect, it } from 'vitest'
import {
  configureMembraneTurnServers,
  filterOutgoingMembraneCandidateEvent,
  normalizeIntegratedTurnServers,
  shouldSkipStaleMembraneMediaEvent
} from './membrane-native.ts'

describe('membrane-native', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('keeps integrated TURN payloads with browser-style ICE servers intact', () => {
    const mediaEvent = JSON.stringify({
      data: {
        data: {
          integratedTurnServers: [
            {
              urls: ['stun:127.0.0.1:50006', 'turn:127.0.0.1:50006?transport=udp'],
              username: 'integrated-user',
              credential: 'integrated-pass'
            }
          ]
        }
      }
    })

    expect(JSON.parse(normalizeIntegratedTurnServers({} as never, mediaEvent))).toEqual({
      data: {
        data: {
          integratedTurnServers: [
            {
              urls: ['stun:127.0.0.1:50006', 'turn:127.0.0.1:50006?transport=udp'],
              username: 'integrated-user',
              credential: 'integrated-pass'
            }
          ]
        }
      }
    })
  })

  it('configures TURN-backed ICE servers when credentials are available', () => {
    const client = {
      rtcConfig: {
        iceServers: [],
        iceTransportPolicy: 'all'
      }
    }

    configureMembraneTurnServers(client as never, {
      username: 'turn-user',
      password: 'turn-pass',
      ttl_seconds: 600,
      expires_at: '2026-04-11T12:00:00.000Z',
      uris: ['turn:turn.example.test:3478?transport=udp']
    })

    expect(client.rtcConfig.iceServers).toEqual([
      {
        urls: ['turn:turn.example.test:3478?transport=udp'],
        username: 'turn-user',
        credential: 'turn-pass'
      }
    ])
    expect(client.rtcConfig.iceTransportPolicy).toBe('all')
  })

  it('keeps integrated TURN payloads unchanged when tcp and udp are both advertised', () => {
    const mediaEvent = JSON.stringify({
      data: {
        data: {
          integratedTurnServers: [
            {
              serverAddr: '192.168.1.11',
              serverPort: 50012,
              transport: 'tcp',
              username: 'tcp-user',
              password: 'tcp-pass'
            },
            {
              serverAddr: '192.168.1.11',
              serverPort: 50032,
              transport: 'udp',
              username: 'udp-user',
              password: 'udp-pass'
            }
          ]
        }
      }
    })

    expect(JSON.parse(normalizeIntegratedTurnServers({} as never, mediaEvent))).toEqual({
      data: {
        data: {
          integratedTurnServers: [
            {
              serverAddr: '192.168.1.11',
              serverPort: 50012,
              transport: 'tcp',
              username: 'tcp-user',
              password: 'tcp-pass'
            },
            {
              serverAddr: '192.168.1.11',
              serverPort: 50032,
              transport: 'udp',
              username: 'udp-user',
              password: 'udp-pass'
            }
          ]
        }
      }
    })
  })

  it('passes through candidate events unchanged', () => {
    const candidateEvent = JSON.stringify({
      type: 'custom',
      data: {
        type: 'candidate',
        data: {
          candidate:
            'candidate:123 1 udp 2122194687 100.105.36.43 50315 typ host generation 0 ufrag test network-id 2 network-cost 50',
          sdpMLineIndex: 0
        }
      }
    })

    expect(filterOutgoingMembraneCandidateEvent(candidateEvent)).toBe(candidateEvent)
  })

  it('skips stale remote tracksRemoved events when the endpoint is already gone', () => {
    const client = {
      idToEndpoint: new Map(),
      localEndpoint: { id: 'local-endpoint' },
      trackIdToTrack: new Map()
    }

    const mediaEvent = JSON.stringify({
      type: 'tracksRemoved',
      data: {
        endpointId: 'remote-endpoint',
        trackIds: ['track-1']
      }
    })

    expect(shouldSkipStaleMembraneMediaEvent(client as never, mediaEvent)).toBe(true)
  })

  it('does not skip local endpoint removal events', () => {
    const client = {
      idToEndpoint: new Map(),
      localEndpoint: { id: 'local-endpoint' },
      trackIdToTrack: new Map()
    }

    const mediaEvent = JSON.stringify({
      type: 'endpointRemoved',
      data: {
        id: 'local-endpoint'
      }
    })

    expect(shouldSkipStaleMembraneMediaEvent(client as never, mediaEvent)).toBe(false)
  })
})
