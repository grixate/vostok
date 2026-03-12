import { useState, useRef, useEffect, useCallback } from 'react'
import type { AttachmentDescriptor } from '../../types.ts'

type VoiceMessageBubbleProps = {
  descriptor: AttachmentDescriptor
  playbackUrl: string
  side: 'incoming' | 'outgoing'
}

const WAVEFORM_BARS = 30

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const SPEEDS = [1, 1.5, 2] as const

export function VoiceMessageBubble({ descriptor, playbackUrl, side }: VoiceMessageBubbleProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // 0–1
  const [duration, setDuration] = useState(0)
  const [speedIndex, setSpeedIndex] = useState(0)
  const [unplayed, setUnplayed] = useState(true)
  const seekingRef = useRef(false)

  const currentSpeed = SPEEDS[speedIndex] ?? 1

  // Sync audio element speed
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = currentSpeed
    }
  }, [currentSpeed])

  function handleMetadata() {
    if (audioRef.current) {
      setDuration(audioRef.current.duration || 0)
    }
  }

  function handleTimeUpdate() {
    if (!seekingRef.current && audioRef.current) {
      const d = audioRef.current.duration
      if (d && d > 0) setProgress(audioRef.current.currentTime / d)
    }
  }

  function handleEnded() {
    setPlaying(false)
    setProgress(0)
    if (audioRef.current) audioRef.current.currentTime = 0
  }

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    setUnplayed(false)
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }

  function cycleSpeed() {
    setSpeedIndex((i) => (i + 1) % SPEEDS.length)
  }

  // Waveform seek
  const handleWaveformClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = ratio * (audio.duration || 0)
    setProgress(ratio)
    setUnplayed(false)
  }, [])

  // Build waveform bar heights — use descriptor.waveform if available, else uniform
  const waveform: number[] = descriptor.waveform?.length
    ? descriptor.waveform
    : Array.from({ length: WAVEFORM_BARS }, (_, i) => 0.3 + 0.4 * Math.sin(i * 0.8))

  // Normalise to WAVEFORM_BARS samples
  const bars: number[] = Array.from({ length: WAVEFORM_BARS }, (_, i) => {
    const idx = Math.floor((i / WAVEFORM_BARS) * waveform.length)
    return Math.max(0.06, Math.min(1, waveform[idx] ?? 0.3))
  })

  const displayDuration = duration > 0 ? formatDuration(duration * (1 - progress)) : '0:00'

  return (
    <div className={`voice-bubble voice-bubble--${side}`}>
      <audio
        ref={audioRef}
        src={playbackUrl}
        onLoadedMetadata={handleMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        preload="metadata"
      />

      {/* Play/pause button */}
      <button
        type="button"
        className="voice-bubble__play-btn"
        onClick={togglePlay}
        aria-label={playing ? 'Pause' : 'Play voice message'}
      >
        {playing ? (
          // Pause bars
          <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true">
            <rect x="4" y="3" width="4" height="14" rx="1.5" />
            <rect x="12" y="3" width="4" height="14" rx="1.5" />
          </svg>
        ) : (
          // Play triangle
          <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M5 3L17 10L5 17V3Z" />
          </svg>
        )}
        {unplayed && <span className="voice-bubble__unplayed-dot" aria-label="Unplayed" />}
      </button>

      {/* Waveform */}
      <svg
        className="voice-bubble__waveform"
        viewBox={`0 0 ${WAVEFORM_BARS * 5} 32`}
        preserveAspectRatio="none"
        onClick={handleWaveformClick}
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Voice message progress"
      >
        {bars.map((h, i) => {
          const barH = Math.max(3, h * 30)
          const played = i / WAVEFORM_BARS <= progress
          return (
            <rect
              key={i}
              x={i * 5 + 1}
              y={(32 - barH) / 2}
              width={3}
              height={barH}
              rx={1.5}
              className={played ? 'voice-bubble__bar voice-bubble__bar--played' : 'voice-bubble__bar'}
            />
          )
        })}
      </svg>

      {/* Footer: duration + speed */}
      <div className="voice-bubble__footer">
        <span className="voice-bubble__duration">{displayDuration}</span>
        <button
          type="button"
          className="voice-bubble__speed"
          onClick={cycleSpeed}
          aria-label={`Playback speed: ${currentSpeed}×`}
        >
          {currentSpeed}×
        </button>
      </div>
    </div>
  )
}
