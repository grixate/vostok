import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configureMembraneTurnServers,
  filterOutgoingMembraneCandidateEvent,
  installSafeOnTrackHandler,
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

  it('keeps multiple pending ontrack events alive until mids are assigned', () => {
    const emit = vi.fn()
    const transceiverA = { mid: null as string | null }
    const transceiverB = { mid: null as string | null }
    const trackA = { id: 'media-a', kind: 'video' } as MediaStreamTrack
    const trackB = { id: 'media-b', kind: 'video' } as MediaStreamTrack
    const streamA = { id: 'stream-a' } as MediaStream
    const streamB = { id: 'stream-b' } as MediaStream
    const trackContextA = { stream: null, track: null }
    const trackContextB = { stream: null, track: null }

    const client = {
      emit,
      onTrack() {
        return () => undefined
      },
      midToTrackId: new Map<string | null, string>(),
      trackIdToTrack: new Map([
        ['remote-track-a', trackContextA],
        ['remote-track-b', trackContextB]
      ]),
      localEndpoint: { id: 'local' },
      checkIfTrackBelongToEndpoint: () => false
    }

    installSafeOnTrackHandler(client as never)

    const onTrack = client.onTrack() as (event: RTCTrackEvent) => void
    onTrack({
      streams: [streamA],
      track: trackA,
      transceiver: transceiverA as unknown as RTCRtpTransceiver
    } as unknown as RTCTrackEvent)
    onTrack({
      streams: [streamB],
      track: trackB,
      transceiver: transceiverB as unknown as RTCRtpTransceiver
    } as unknown as RTCTrackEvent)

    transceiverA.mid = '0'
    transceiverB.mid = '1'
    client.midToTrackId.set('0', 'remote-track-a')
    client.midToTrackId.set('1', 'remote-track-b')

    ;(client as { __vostokApplyPendingOnTrack?: () => void }).__vostokApplyPendingOnTrack?.()

    expect(trackContextA).toEqual({ stream: streamA, track: trackA })
    expect(trackContextB).toEqual({ stream: streamB, track: trackB })
    expect(emit).toHaveBeenNthCalledWith(1, 'trackReady', trackContextA)
    expect(emit).toHaveBeenNthCalledWith(2, 'trackReady', trackContextB)
  })
})
