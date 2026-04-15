import { useState, useRef, useEffect } from 'react'
import { t } from '../../lib/i18n.ts'
import type { AttachmentDescriptor } from '../../types.ts'
import { VolumeOffIcon, VolumeOnIcon } from '../../icons/index.tsx'

const DIAMETER = 220

type RoundVideoBubbleProps = {
  descriptor: AttachmentDescriptor
  playbackUrl: string
  side: 'incoming' | 'outgoing'
  timestamp?: string
}

type RoundVideoProgressInput = {
  currentTime: number
  seekableEnd: number
  duration: number
}

export function getRoundVideoPlayableDuration({ seekableEnd, duration }: Omit<RoundVideoProgressInput, 'currentTime'>): number {
  if (seekableEnd > 0) {
    return seekableEnd
  }
  return Number.isFinite(duration) && duration > 0 ? duration : 0
}

export function getRoundVideoProgress({ currentTime, seekableEnd, duration }: RoundVideoProgressInput): number {
  const total = getRoundVideoPlayableDuration({ seekableEnd, duration })
  if (total <= 0) {
    return 0
  }
  return Math.min(1, Math.max(0, currentTime / total))
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function RoundVideoBubble({ descriptor, playbackUrl, side, timestamp }: RoundVideoBubbleProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [muted, setMuted] = useState(false)
  const [duration, setDuration] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const el = video

    function getSeekableEnd() {
      if (el.seekable.length > 0) {
        return el.seekable.end(el.seekable.length - 1) || 0
      }
      return 0
    }
    function getPlayableDuration() {
      return getRoundVideoPlayableDuration({
        seekableEnd: getSeekableEnd(),
        duration: el.duration
      })
    }
    function syncDuration() {
      setDuration(getPlayableDuration())
    }
    function onTimeUpdate() {
      const current = el.currentTime || 0
      setElapsed(current)
      setProgress(getRoundVideoProgress({
        currentTime: current,
        seekableEnd: getSeekableEnd(),
        duration: el.duration
      }))
      // First timeupdate means a frame has been decoded and rendered
      setVideoReady(true)
    }
    function onPlay() {
      setPlaying(true)
    }
    function onPause() {
      setPlaying(false)
    }
    function onEnded() {
      const end = getPlayableDuration()
      setPlaying(false)
      setVideoReady(true)
      setElapsed(end)
      setDuration(end)
      setProgress(1)
    }

    video.addEventListener('loadedmetadata', syncDuration)
    video.addEventListener('durationchange', syncDuration)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('loadedmetadata', syncDuration)
      video.removeEventListener('durationchange', syncDuration)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
    }
  }, [playbackUrl])

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      video.pause()
    } else {
      const end = duration > 0 ? duration : video.duration
      if (end > 0 && video.currentTime >= end - 0.05) {
        video.currentTime = 0
        setElapsed(0)
        setProgress(0)
      }
      void video.play().catch(() => setPlaying(false))
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

        {/* Thumbnail preview — visible until video has decoded its first frame */}
        {descriptor.thumbnailDataUrl && !(playing && videoReady) && (
          <img
            className="round-video__poster"
            src={descriptor.thumbnailDataUrl}
            alt=""
            style={{ width: DIAMETER - 6, height: DIAMETER - 6 }}
          />
        )}

        {/* Video element — transparent until a frame is ready */}
        <video
          ref={videoRef}
          src={playbackUrl}
          className="round-video__video"
          preload="metadata"
          playsInline
          onClick={togglePlay}
          aria-label={descriptor.fileName}
          style={{ width: DIAMETER - 6, height: DIAMETER - 6, opacity: playing && videoReady ? 1 : 0 }}
        />

        {/* Play overlay when paused */}
        {!playing && (
          <button
            type="button"
            className="round-video__play-overlay"
            onClick={togglePlay}
            aria-label={t('play_video')}
          >
            <svg viewBox="0 0 20 20" width="24" height="24" fill="white" aria-hidden="true">
              <path d="M5 3L17 10L5 17V3Z" />
            </svg>
          </button>
        )}

        {/* Buffering spinner — shown when play was requested but video isn't ready */}
        {playing && !videoReady && (
          <div className="round-video__play-overlay" style={{ cursor: 'default' }}>
            <span className="round-video__loading-spinner" />
          </div>
        )}

        {/* Duration badge — shown when paused */}
        {!playing && duration > 0 && (
          <div className="round-video__duration-badge">
            <span className="round-video__duration-dot" />
            <span className="round-video__duration-text">{formatDuration(duration)}</span>
          </div>
        )}

        {/* Mute toggle */}
        <button
          type="button"
          className="round-video__mute-btn"
          onClick={toggleMute}
          aria-label={muted ? t('unmute') : t('mute')}
        >
          {muted
            ? <VolumeOffIcon width={14} height={14} />
            : <VolumeOnIcon width={14} height={14} />}
        </button>
      </div>

      {/* Caption row */}
      <div className="round-video__caption">
        {timestamp && <span className="round-video__timestamp">{timestamp}</span>}
      </div>
    </div>
  )
}
