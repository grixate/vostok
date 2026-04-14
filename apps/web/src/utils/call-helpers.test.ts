import { describe, expect, it } from 'vitest'
import { pickPreferredDirectRemoteMedia } from './call-helpers.ts'
import type { MembraneRemoteTrackSnapshot } from '../lib/membrane-native.ts'

function buildTrack(overrides: Partial<MembraneRemoteTrackSnapshot>): MembraneRemoteTrackSnapshot {
  return {
    id: overrides.id ?? 'track-1',
    endpointId: overrides.endpointId ?? 'endpoint-1',
    kind: overrides.kind ?? 'video',
    source: overrides.source ?? 'browser',
    ready: overrides.ready ?? true,
    mediaTrack: overrides.mediaTrack ?? ({ id: overrides.id ?? 'media-track-1' } as MediaStreamTrack),
    voiceActivity: overrides.voiceActivity ?? null
  }
}

describe('pickPreferredDirectRemoteMedia', () => {
  it('keeps camera video and remote screenshare separate for direct calls', () => {
    const audioTrack = buildTrack({ id: 'audio-1', kind: 'audio' })
    const cameraTrack = buildTrack({ id: 'video-1', kind: 'video', source: 'browser' })
    const screenShareTrack = buildTrack({ id: 'video-2', kind: 'video', source: 'screenshare' })

    expect(
      pickPreferredDirectRemoteMedia([audioTrack, cameraTrack, screenShareTrack])
    ).toMatchObject({
      audioTrack: { id: 'audio-1' },
      videoTrack: { id: 'video-1' },
      screenShareTrack: { id: 'video-2' }
    })
  })

  it('promotes screenshare when it is the only remote video track', () => {
    const screenShareTrack = buildTrack({ id: 'video-2', kind: 'video', source: 'screenshare' })

    expect(
      pickPreferredDirectRemoteMedia([screenShareTrack])
    ).toMatchObject({
      audioTrack: null,
      videoTrack: { id: 'video-2' },
      screenShareTrack: null
    })
  })

  it('ignores placeholder video tracks when choosing primary remote video', () => {
    const placeholderTrack = buildTrack({ id: 'video-1', kind: 'video', source: 'placeholder' })
    const cameraTrack = buildTrack({ id: 'video-2', kind: 'video', source: 'browser' })

    expect(
      pickPreferredDirectRemoteMedia([placeholderTrack, cameraTrack])
    ).toMatchObject({
      videoTrack: { id: 'video-2' },
      screenShareTrack: null
    })
  })
})
