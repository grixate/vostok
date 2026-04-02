import type { MembraneClient } from './membrane-native.ts'

export function stopLocalMediaStream(stream: MediaStream | null) {
  if (!stream) {
    return
  }

  for (const track of stream.getTracks()) {
    track.stop()
  }
}

export async function releaseLocalMediaResources(
  membraneClient: MembraneClient | null,
  trackIds: string[],
  stream: MediaStream | null,
  removeLocalTracksFromMembrane: (client: MembraneClient | null, trackIds: string[]) => Promise<unknown>
) {
  await removeLocalTracksFromMembrane(membraneClient, trackIds)
  stopLocalMediaStream(stream)
}

export function describeMediaDeviceError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return 'Camera/microphone access was blocked. Please check your browser permissions and try again.'
      case 'NotFoundError':
        return 'No camera or microphone found. Please connect a device and try again.'
      case 'NotReadableError':
        return 'Camera/microphone is in use by another application. Please close it and try again.'
      case 'OverconstrainedError':
        return 'Camera does not support the requested resolution. Trying with default settings.'
      default:
        return `Media error: ${error.message}`
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Failed to access media devices.'
}

export async function replaceLocalMediaStream(options: {
  mode: 'audio' | 'audio_video'
  currentStream: MediaStream | null
  membraneClient: MembraneClient | null
  membraneClientConnected: boolean
  membraneLocalTrackIds: string[]
  removeLocalTracksFromMembrane: (client: MembraneClient | null, trackIds: string[]) => Promise<unknown>
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  attachLocalTracks: (client: MembraneClient, stream: MediaStream) => Promise<string[]>
}): Promise<{
  stream: MediaStream
  trackIds: string[]
  localMediaMode: 'audio' | 'audio_video'
  localAudioTrackCount: number
  localVideoTrackCount: number
}> {
  const {
    mode,
    currentStream,
    membraneClient,
    membraneClientConnected,
    membraneLocalTrackIds,
    removeLocalTracksFromMembrane,
    getUserMedia,
    attachLocalTracks
  } = options

  if (currentStream) {
    if (membraneClient && membraneClientConnected) {
      await removeLocalTracksFromMembrane(membraneClient, membraneLocalTrackIds)
    }
    stopLocalMediaStream(currentStream)
  }

  const stream = await getUserMedia(
    mode === 'audio'
      ? { audio: true, video: false }
      : {
          audio: true,
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        }
  )

  const trackIds =
    membraneClient && membraneClientConnected
      ? await attachLocalTracks(membraneClient, stream)
      : []

  return {
    stream,
    trackIds,
    localMediaMode: mode,
    localAudioTrackCount: stream.getAudioTracks().length,
    localVideoTrackCount: stream.getVideoTracks().length
  }
}

export function updateHiddenVideoTrackState(
  stream: MediaStream | null,
  hidden: boolean,
  hiddenVideoTrackState: WeakMap<MediaStreamTrack, boolean>
) {
  if (!stream) {
    return
  }

  for (const track of stream.getVideoTracks()) {
    if (hidden) {
      hiddenVideoTrackState.set(track, track.enabled)
      track.enabled = false
    } else {
      const previousEnabled = hiddenVideoTrackState.get(track)
      track.enabled = previousEnabled ?? track.enabled
      hiddenVideoTrackState.delete(track)
    }
  }
}
