import { useEffect, useRef } from 'react'
import type { MembraneRemoteTrackSnapshot } from '../lib/membrane-native'

export function RemoteMembraneTrackPreview({
  track,
  featured = false
}: {
  track: MembraneRemoteTrackSnapshot
  featured?: boolean
}) {
  const mediaElementRef = useRef<HTMLMediaElement | null>(null)

  useEffect(() => {
    const mediaElement = mediaElementRef.current

    if (!mediaElement) {
      return
    }

    if (!track.ready || !track.mediaTrack || !track.kind) {
      mediaElement.srcObject = null
      return
    }

    const previewStream = new MediaStream([track.mediaTrack])
    mediaElement.srcObject = previewStream

    return () => {
      if (mediaElementRef.current === mediaElement) {
        mediaElement.srcObject = null
      }
    }
  }, [track.id, track.kind, track.mediaTrack, track.ready])

  if (!track.ready || !track.mediaTrack || !track.kind) {
    return null
  }

  return (
    <div className={featured ? 'call-preview call-preview--featured' : 'call-preview'}>
      {track.kind === 'audio' ? (
        <audio
          autoPlay
          controls
          playsInline
          ref={(element) => {
            mediaElementRef.current = element
          }}
        />
      ) : (
        <video
          autoPlay
          muted
          playsInline
          ref={(element) => {
            mediaElementRef.current = element
          }}
        />
      )}
    </div>
  )
}
