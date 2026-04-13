import { describe, expect, it } from 'vitest'
import {
  CALL_REALTIME_EVENT_ARBITRATION_WINDOW_MS,
  CALL_RECONNECT_STABLE_RESET_MS,
  isCallDebugVerboseEnabled,
  nextReconnectDelayMs,
  selectPrimaryLocalSenderTrackIds,
  shouldBypassMembraneEventDedupe,
  shouldSkipPolledCriticalEvent,
  shouldResetReconnectAttempts
} from './call-stability.ts'

describe('call-stability', () => {
  it('enables verbose debug by default in dev with local override support', () => {
    expect(
      isCallDebugVerboseEnabled({
        dev: false,
        buildVerbose: true,
        runtimeOverride: '1'
      })
    ).toBe(false)

    expect(
      isCallDebugVerboseEnabled({
        dev: true,
        buildVerbose: false,
        runtimeOverride: null
      })
    ).toBe(true)

    expect(
      isCallDebugVerboseEnabled({
        dev: true,
        buildVerbose: true,
        runtimeOverride: null
      })
    ).toBe(true)

    expect(
      isCallDebugVerboseEnabled({
        dev: true,
        buildVerbose: true,
        runtimeOverride: '0'
      })
    ).toBe(false)

    expect(
      isCallDebugVerboseEnabled({
        dev: true,
        buildVerbose: false,
        runtimeOverride: '1'
      })
    ).toBe(true)
  })

  it('returns bounded reconnect backoff delays', () => {
    expect(nextReconnectDelayMs(0)).toBe(500)
    expect(nextReconnectDelayMs(1)).toBe(1_000)
    expect(nextReconnectDelayMs(2)).toBe(2_000)
    expect(nextReconnectDelayMs(3)).toBe(4_000)
    expect(nextReconnectDelayMs(4)).toBe(8_000)
    expect(nextReconnectDelayMs(10)).toBe(8_000)
  })

  it('resets reconnect attempts only after stable window elapses', () => {
    const now = Date.now()
    expect(shouldResetReconnectAttempts(null, now)).toBe(false)
    expect(shouldResetReconnectAttempts(now - (CALL_RECONNECT_STABLE_RESET_MS - 1), now)).toBe(false)
    expect(shouldResetReconnectAttempts(now - CALL_RECONNECT_STABLE_RESET_MS, now)).toBe(true)
  })

  it('always bypasses dedupe for restart-critical negotiation events', () => {
    expect(shouldBypassMembraneEventDedupe('offerData')).toBe(true)
    expect(shouldBypassMembraneEventDedupe('answer')).toBe(true)
    expect(shouldBypassMembraneEventDedupe('candidate')).toBe(true)
    expect(shouldBypassMembraneEventDedupe('integratedTurnServers')).toBe(false)
    expect(shouldBypassMembraneEventDedupe(null)).toBe(false)
  })

  it('skips poll-side critical duplicates when the same event arrived via realtime recently', () => {
    const now = Date.now()

    expect(shouldSkipPolledCriticalEvent(now, now)).toBe(true)
    expect(
      shouldSkipPolledCriticalEvent(
        now - CALL_REALTIME_EVENT_ARBITRATION_WINDOW_MS + 1,
        now
      )
    ).toBe(true)
    expect(
      shouldSkipPolledCriticalEvent(
        now - CALL_REALTIME_EVENT_ARBITRATION_WINDOW_MS - 1,
        now
      )
    ).toBe(false)
    expect(shouldSkipPolledCriticalEvent(null, now)).toBe(false)
  })

  it('selects one primary local sender per kind and marks duplicates for removal', () => {
    const result = selectPrimaryLocalSenderTrackIds(
      [
        {
          trackId: 'audio-old',
          kind: 'audio',
          source: 'browser',
          mediaTrackId: 'audio-stale'
        },
        {
          trackId: 'audio-new',
          kind: 'audio',
          source: 'browser',
          mediaTrackId: 'audio-active'
        },
        {
          trackId: 'video-old',
          kind: 'video',
          source: 'placeholder',
          mediaTrackId: 'video-old-track'
        },
        {
          trackId: 'video-new',
          kind: 'video',
          source: 'browser',
          mediaTrackId: 'video-active'
        }
      ],
      {
        audio: 'audio-active',
        video: 'video-active'
      }
    )

    expect(result.keep.sort()).toEqual(['audio-new', 'video-new'])
    expect(result.remove.sort()).toEqual(['audio-old', 'video-old'])
  })
})
