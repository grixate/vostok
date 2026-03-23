import { useRef, useEffect } from 'react'
import { MicOffIcon } from '../../icons/index.tsx'

type ParticipantTileProps = {
  name: string
  initial: string
  stream: MediaStream | null
  videoEnabled: boolean
  audioMuted: boolean
  isSpeaking: boolean
  connectionQuality?: 'good' | 'fair' | 'poor'
}

export function ParticipantTile({
  name,
  initial,
  stream,
  videoEnabled,
  audioMuted,
  isSpeaking,
  connectionQuality = 'good',
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (el && stream) el.srcObject = stream
    return () => { if (el) el.srcObject = null }
  }, [stream])

  return (
    <div className={`participant-tile${isSpeaking ? ' participant-tile--speaking' : ''}`}>
      {videoEnabled && stream ? (
        <video
          ref={videoRef}
          className="participant-tile__video"
          autoPlay
          playsInline
          muted
        />
      ) : (
        <div className="participant-tile__avatar">
          {initial}
        </div>
      )}
      <span className="participant-tile__name">{name}</span>
      {audioMuted && (
        <span className="participant-tile__mute">
          <MicOffIcon width={14} height={14} />
        </span>
      )}
      <span className={`participant-tile__quality participant-tile__quality--${connectionQuality}`} />
    </div>
  )
}
