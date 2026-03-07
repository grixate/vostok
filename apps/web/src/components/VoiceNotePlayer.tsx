import { useEffect, useRef, useState } from 'react'
import type { AttachmentDescriptor } from '../types'
import { formatMediaClock } from '../utils/format'

export function VoiceNotePlayer({
  attachment,
  onResolveMediaUrl
}: {
  attachment: AttachmentDescriptor
  onResolveMediaUrl: (attachment: AttachmentDescriptor) => Promise<string>
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [positionSeconds, setPositionSeconds] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [volume, setVolume] = useState(1)

  useEffect(() => {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    const syncPosition = () => setPositionSeconds(audio.currentTime || 0)
    const syncDuration = () => setDurationSeconds(Number.isFinite(audio.duration) ? audio.duration : 0)
    const syncPlaybackState = () => setPlaying(!audio.paused)

    audio.addEventListener('timeupdate', syncPosition)
    audio.addEventListener('loadedmetadata', syncDuration)
    audio.addEventListener('durationchange', syncDuration)
    audio.addEventListener('play', syncPlaybackState)
    audio.addEventListener('pause', syncPlaybackState)
    audio.addEventListener('ended', syncPlaybackState)

    audio.volume = volume
    audio.playbackRate = playbackRate

    return () => {
      audio.removeEventListener('timeupdate', syncPosition)
      audio.removeEventListener('loadedmetadata', syncDuration)
      audio.removeEventListener('durationchange', syncDuration)
      audio.removeEventListener('play', syncPlaybackState)
      audio.removeEventListener('pause', syncPlaybackState)
      audio.removeEventListener('ended', syncPlaybackState)
    }
  }, [playbackRate, volume])

  useEffect(() => {
    setMediaUrl(null)
    setError(null)
    setPlaying(false)
    setPositionSeconds(0)
    setDurationSeconds(0)
  }, [attachment.uploadId])

  async function handleLoad() {
    setLoading(true)
    setError(null)

    try {
      const resolved = await onResolveMediaUrl(attachment)
      setMediaUrl(resolved)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load the voice note.')
    } finally {
      setLoading(false)
    }
  }

  function handleTogglePlayback() {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    if (audio.paused) {
      void audio.play().catch(() => undefined)
      return
    }

    audio.pause()
  }

  function handleSeek(nextSeconds: number) {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    audio.currentTime = Math.max(0, Math.min(nextSeconds, durationSeconds || 0))
    setPositionSeconds(audio.currentTime)
  }

  if (!mediaUrl) {
    return (
      <div className="voice-note-player">
        <button className="secondary-action" disabled={loading} onClick={() => void handleLoad()} type="button">
          {loading ? 'Loading voice note…' : 'Play Voice Note'}
        </button>
        {error ? <span className="settings-card__muted">{error}</span> : null}
      </div>
    )
  }

  return (
    <div className="voice-note-player">
      <audio preload="metadata" ref={audioRef} src={mediaUrl} />
      <div className="voice-note-player__controls">
        <button className="mini-action" onClick={handleTogglePlayback} type="button">
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          className="mini-action"
          onClick={() => handleSeek(Math.max(0, positionSeconds - 10))}
          type="button"
        >
          -10s
        </button>
        <button
          className="mini-action"
          onClick={() => handleSeek(Math.min(durationSeconds || 0, positionSeconds + 10))}
          type="button"
        >
          +10s
        </button>
        <label className="voice-note-player__field">
          <span>{formatMediaClock(positionSeconds)} / {formatMediaClock(durationSeconds)}</span>
          <input
            max={Math.max(durationSeconds, 0.1)}
            min={0}
            onChange={(event) => handleSeek(Number(event.target.value))}
            step={0.1}
            type="range"
            value={Math.min(positionSeconds, durationSeconds || 0)}
          />
        </label>
      </div>
      <div className="voice-note-player__controls">
        <label className="voice-note-player__field">
          <span>Speed</span>
          <select
            onChange={(event) => setPlaybackRate(Number(event.target.value))}
            value={playbackRate}
          >
            <option value={0.75}>0.75x</option>
            <option value={1}>1.0x</option>
            <option value={1.25}>1.25x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2.0x</option>
          </select>
        </label>
        <label className="voice-note-player__field">
          <span>Volume</span>
          <input
            max={1}
            min={0}
            onChange={(event) => setVolume(Number(event.target.value))}
            step={0.05}
            type="range"
            value={volume}
          />
        </label>
      </div>
    </div>
  )
}
