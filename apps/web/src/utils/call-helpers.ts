import type { CallSignal } from '../lib/api.ts'
import type { MembraneRemoteTrackSnapshot } from '../lib/membrane-native.ts'

export function mergeCallSignals(current: CallSignal[], nextSignal: CallSignal): CallSignal[] {
  return [...current.filter((signal) => signal.id !== nextSignal.id), nextSignal]
    .sort((left, right) => left.inserted_at.localeCompare(right.inserted_at))
    .slice(-12)
}

export function readMembraneNativeEventType(eventPayload: string): string | null {
  try {
    const parsed = JSON.parse(eventPayload) as {
      type?: unknown
    }

    return typeof parsed.type === 'string' ? parsed.type : null
  } catch {
    return null
  }
}

export function truncateSignalPayload(payload: string): string {
  return payload.length > 88 ? `${payload.slice(0, 85)}...` : payload
}

export function buildDesktopWindowTitle(
  activeChatTitle: string | null,
  activeCallMode: 'voice' | 'video' | 'group' | null
): string {
  const parts = ['Vostok']

  if (activeChatTitle) {
    parts.push(activeChatTitle)
  }

  if (activeCallMode) {
    const label =
      activeCallMode === 'group'
        ? 'Group Call'
        : activeCallMode === 'video'
          ? 'Video Call'
          : 'Voice Call'

    parts.push(label)
  }

  return parts.join(' \u2022 ')
}

export function pickDominantRemoteSpeakerEndpointId(
  tracks: MembraneRemoteTrackSnapshot[]
): string | null {
  const speakingAudioTrack = tracks.find(
    (track) => track.ready && track.kind === 'audio' && track.voiceActivity === 'speech'
  )

  if (speakingAudioTrack) {
    return speakingAudioTrack.endpointId
  }

  const speakingTrack = tracks.find((track) => track.ready && track.voiceActivity === 'speech')

  if (speakingTrack) {
    return speakingTrack.endpointId
  }

  return null
}

export function pickFeaturedRemoteTrack(
  tracks: MembraneRemoteTrackSnapshot[],
  dominantEndpointId: string | null
): MembraneRemoteTrackSnapshot | null {
  if (dominantEndpointId) {
    const dominantVideoTrack = tracks.find(
      (track) => track.ready && track.kind === 'video' && track.endpointId === dominantEndpointId
    )

    if (dominantVideoTrack) {
      return dominantVideoTrack
    }

    const dominantTrack = tracks.find(
      (track) => track.ready && track.endpointId === dominantEndpointId
    )

    if (dominantTrack) {
      return dominantTrack
    }
  }

  const firstReadyVideoTrack = tracks.find((track) => track.ready && track.kind === 'video')

  if (firstReadyVideoTrack) {
    return firstReadyVideoTrack
  }

  return tracks.find((track) => track.ready) ?? null
}
