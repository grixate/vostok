import { useState, useEffect } from 'react'
import type { MembraneRemoteTrackSnapshot } from '../lib/membrane-native.ts'
import { pickDominantRemoteSpeakerEndpointId } from '../utils/call-helpers.ts'

export function useActiveSpeaker(
  tracks: MembraneRemoteTrackSnapshot[],
  intervalMs = 500
): string | null {
  const [speakerId, setSpeakerId] = useState<string | null>(null)

  useEffect(() => {
    if (tracks.length === 0) {
      setSpeakerId(null)
      return
    }

    function update() {
      setSpeakerId(pickDominantRemoteSpeakerEndpointId(tracks))
    }

    update()
    const timer = setInterval(update, intervalMs)
    return () => clearInterval(timer)
  }, [tracks, intervalMs])

  return speakerId
}
