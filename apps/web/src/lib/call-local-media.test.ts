import { describe, expect, it, vi } from 'vitest'
import {
  describeMediaDeviceError,
  releaseLocalMediaResources,
  replaceLocalMediaStream,
  stopLocalMediaStream,
  updateHiddenVideoTrackState
} from './call-local-media.ts'

function createTrack(kind: 'audio' | 'video', enabled = true) {
  return {
    kind,
    enabled,
    stop: vi.fn()
  } as unknown as MediaStreamTrack
}

function createStream(audioCount = 1, videoCount = 1) {
  const audioTracks = Array.from({ length: audioCount }, () => createTrack('audio'))
  const videoTracks = Array.from({ length: videoCount }, () => createTrack('video'))

  return {
    getTracks: () => [...audioTracks, ...videoTracks],
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks
  } as unknown as MediaStream
}

describe('call-local-media', () => {
  it('stops all tracks on a local stream', () => {
    const stream = createStream(1, 2)
    stopLocalMediaStream(stream)

    for (const track of stream.getTracks()) {
      expect(track.stop).toHaveBeenCalled()
    }
  })

  it('releases membrane tracks before stopping local media', async () => {
    const remove = vi.fn(async () => undefined)
    const stream = createStream()

    await releaseLocalMediaResources(null, ['track-1'], stream, remove)

    expect(remove).toHaveBeenCalledWith(null, ['track-1'])
    for (const track of stream.getTracks()) {
      expect(track.stop).toHaveBeenCalled()
    }
  })

  it('replaces local media, cleans up the old stream, and attaches to Membrane when connected', async () => {
    const oldStream = createStream()
    const newStream = createStream(1, 0)
    const remove = vi.fn(async () => undefined)
    const attach = vi.fn(async () => ['track-audio'])

    const result = await replaceLocalMediaStream({
      mode: 'audio',
      currentStream: oldStream,
      membraneClient: {} as never,
      membraneClientConnected: true,
      membraneLocalTrackIds: ['old-track'],
      removeLocalTracksFromMembrane: remove,
      getUserMedia: vi.fn(async () => newStream),
      attachLocalTracks: attach
    })

    expect(remove).toHaveBeenCalledWith(expect.anything(), ['old-track'])
    expect(attach).toHaveBeenCalledWith(expect.anything(), newStream)
    expect(result.trackIds).toEqual(['track-audio'])
    expect(result.localAudioTrackCount).toBe(1)
    expect(result.localVideoTrackCount).toBe(0)
  })

  it('maps common media device errors to user-friendly messages', () => {
    expect(describeMediaDeviceError(new DOMException('denied', 'NotAllowedError'))).toContain('blocked')
    expect(describeMediaDeviceError(new DOMException('missing', 'NotFoundError'))).toContain('No camera or microphone found')
    expect(describeMediaDeviceError(new Error('boom'))).toBe('boom')
  })

  it('preserves and restores hidden video track state', () => {
    const stream = createStream(0, 1)
    const videoTrack = stream.getVideoTracks()[0]
    const state = new WeakMap<MediaStreamTrack, boolean>()

    updateHiddenVideoTrackState(stream, true, state)
    expect(videoTrack.enabled).toBe(false)

    updateHiddenVideoTrackState(stream, false, state)
    expect(videoTrack.enabled).toBe(true)
  })
})
