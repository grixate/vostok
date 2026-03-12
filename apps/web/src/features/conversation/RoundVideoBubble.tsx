import { useState, useRef, useEffect } from 'react'
import type { AttachmentDescriptor } from '../../types.ts'
import { VolumeOffIcon, VolumeOnIcon } from '../../icons/index.tsx'

const DIAMETER = 220

type RoundVideoBubbleProps = {
  descriptor: AttachmentDescriptor
  playbackUrl: string
  side: 'incoming' | 'outgoing'
  timestamp?: string
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function RoundVideoBubble({ descriptor, playbackUrl, side, timestamp }: RoundVideoBubbleProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [duration, setDuration] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    function onMeta() { setDuration(video!.duration || 0) }
    function onTimeUpdate() {
      setElapsed(video!.currentTime)
      setProgress(video!.duration > 0 ? video!.currentTime / video!.duration : 0)
    }
    function onEnded() { setPlaying(false); setElapsed(0); setProgress(0); video!.currentTime = 0 }

    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('ended', onEnded)
    }
  }, [playbackUrl])

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      video.pause()
      setPlaying(false)
    } else {
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !muted
    setMuted(!muted)
  }

  // SVG circle progress ring
  const radius = DIAMETER / 2 - 3
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference * (1 - progress)
  const displayTime = playing ? formatDuration(elapsed) : formatDuration(duration)

  return (
    <div className={`round-video round-video--${side}`}>
      <div className="round-video__wrapper" style={{ width: DIAMETER, height: DIAMETER }}>
        {/* Progress ring */}
        <svg
          className="round-video__ring"
          width={DIAMETER}
          height={DIAMETER}
          viewBox={`0 0 ${DIAMETER} ${DIAMETER}`}
          aria-hidden="true"
        >
          <circle
            cx={DIAMETER / 2}
            cy={DIAMETER / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="3"
          />
          <circle
            cx={DIAMETER / 2}
            cy={DIAMETER / 2}
            r={radius}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${DIAMETER / 2} ${DIAMETER / 2})`}
            style={{ transition: 'stroke-dashoffset 0.25s linear' }}
          />
        </svg>

        {/* Video element clipped to circle */}
        <video
          ref={videoRef}
          src={playbackUrl}
          className="round-video__video"
          preload="metadata"
          playsInline
          onClick={togglePlay}
          aria-label={descriptor.fileName}
          style={{ width: DIAMETER - 6, height: DIAMETER - 6 }}
        />

        {/* Play overlay when paused */}
        {!playing && (
          <button
            type="button"
            className="round-video__play-overlay"
            onClick={togglePlay}
            aria-label="Play video message"
          >
            <svg viewBox="0 0 20 20" width="24" height="24" fill="white" aria-hidden="true">
              <path d="M5 3L17 10L5 17V3Z" />
            </svg>
          </button>
        )}

        {/* Mute toggle */}
        <button
          type="button"
          className="round-video__mute-btn"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted
            ? <VolumeOffIcon width={14} height={14} />
            : <VolumeOnIcon width={14} height={14} />}
        </button>
      </div>

      {/* Caption row */}
      <div className="round-video__caption">
        <span className="round-video__time">{displayTime}</span>
        {timestamp && <span className="round-video__timestamp">{timestamp}</span>}
      </div>
    </div>
  )
}
