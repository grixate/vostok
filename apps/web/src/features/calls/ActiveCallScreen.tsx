import { useRef, useEffect, useState } from 'react'
import { CallControls } from './CallControls.tsx'
import { SelfPreviewPiP } from './SelfPreviewPiP.tsx'
import { useCallTimer } from '../../hooks/useCallTimer.ts'
import {
  BackIcon,
  LockIcon,
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
} from '../../icons/index.tsx'

type Participant = {
  id: string
  name: string
  initial: string
  muted?: boolean
}

type ActiveCallScreenProps = {
  contactName: string
  contactInitial: string
  mode: 'voice' | 'video'
  remoteStream: MediaStream | null
  localStream: MediaStream | null
  remoteCameraOn: boolean
  muted: boolean
  cameraOn: boolean
  screenSharing: boolean
  encrypted?: boolean
  emojiFingerprint?: string
  participants?: Participant[]
  onToggleMute: () => void
  onToggleCamera: () => void
  onToggleScreen: () => void
  onHangup: () => void
  onBack?: () => void
}

export function ActiveCallScreen({
  contactName,
  contactInitial,
  mode,
  remoteStream,
  localStream,
  remoteCameraOn,
  muted,
  cameraOn,
  screenSharing,
  encrypted = false,
  emojiFingerprint,
  participants = [],
  onToggleMute,
  onToggleCamera,
  onToggleScreen,
  onHangup,
  onBack,
}: ActiveCallScreenProps) {
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const duration = useCallTimer(true)
  const [layout, setLayout] = useState<'mobile' | 'tablet' | 'desktop'>('desktop')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width < 720) setLayout('mobile')
      else if (width < 1100) setLayout('tablet')
      else setLayout('desktop')
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = remoteVideoRef.current
    if (el && remoteStream) el.srcObject = remoteStream
    return () => { if (el) el.srcObject = null }
  }, [remoteStream])

  useEffect(() => {
    const el = localVideoRef.current
    if (el && localStream) el.srcObject = localStream
    return () => { if (el) el.srcObject = null }
  }, [localStream])

  const showVideo = mode === 'video'
  const emoji = emojiFingerprint || '🐻🦊🐱🐶'

  const encryptionBadge = encrypted ? (
    <div className="ac__badge">
      <LockIcon width={12} height={12} />
      <span>HD · Encrypted</span>
    </div>
  ) : null

  const encryptionEmoji = (
    <div className="ac__emoji-row">
      <LockIcon width={14} height={14} />
      <span>{emoji}</span>
    </div>
  )

  const controlsBar = (
    <div className="ac__controls-bar">
      <CallControls
        muted={muted}
        cameraOn={cameraOn}
        screenSharing={screenSharing}
        showCamera={showVideo}
        onToggleMute={onToggleMute}
        onToggleCamera={onToggleCamera}
        onToggleScreen={onToggleScreen}
        onHangup={onHangup}
      />
    </div>
  )

  // ── Mobile layout ───────────────────────────────────────────────────────
  if (layout === 'mobile') {
    return (
      <div ref={containerRef} className="ac ac--mobile">
        <div className="ac__m-header">
          {onBack && (
            <button type="button" className="ac__back-btn" onClick={onBack}>
              <BackIcon width={20} height={20} />
              <span>Back</span>
            </button>
          )}
          <div className="ac__m-header-spacer" />
          {encryptionEmoji}
        </div>

        <div className="ac__m-body">
          <div className="ac__avatar ac__avatar--96">{contactInitial}</div>
          <span className="ac__name ac__name--20">{contactName}</span>
          <span className="ac__timer">{duration}</span>
          {encryptionBadge}
        </div>

        {controlsBar}
      </div>
    )
  }

  // ── Tablet layout: header + two video panels ────────────────────────────
  if (layout === 'tablet') {
    return (
      <div ref={containerRef} className="ac ac--tablet">
        <div className="ac__t-header">
          <div className="ac__t-header-left">
            <div className="ac__avatar ac__avatar--40">{contactInitial}</div>
            <div className="ac__t-header-info">
              <span className="ac__t-header-name">{contactName}</span>
              <span className="ac__t-header-time">{duration}</span>
            </div>
          </div>
          {encryptionEmoji}
        </div>

        <div className="ac__t-body">
          {/* Left panel: self view */}
          <div className="ac__t-left">
            {localStream && cameraOn ? (
              <video
                ref={localVideoRef}
                className="ac__t-video"
                autoPlay
                playsInline
                muted
              />
            ) : (
              <div className="ac__camera-off">
                <VideoOffIcon width={32} height={32} />
              </div>
            )}
            <div className="ac__vid-overlay">
              <span className="ac__vid-name">{contactName}</span>
              <span className="ac__vid-time">{duration}</span>
            </div>
          </div>

          {/* Right panel: remote view */}
          <div className="ac__t-right">
            {remoteCameraOn && remoteStream ? (
              <video
                ref={remoteVideoRef}
                className="ac__t-video"
                autoPlay
                playsInline
              />
            ) : (
              <div className="ac__camera-off">
                <VideoOffIcon width={32} height={32} />
              </div>
            )}
            <div className="ac__vid-labels">
              <div className="ac__vid-label">
                <MicIcon width={12} height={12} />
              </div>
              <div className="ac__vid-label">
                <MicIcon width={12} height={12} />
                <span>{participants[0]?.name ?? 'Remote'}</span>
              </div>
            </div>

            {/* PiP self-preview */}
            {localStream && cameraOn && (
              <div className="ac__t-pip">
                <SelfPreviewPiP stream={localStream} />
                <div className="ac__pip-label">
                  <MicIcon width={10} height={10} />
                  <span>You</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {controlsBar}
      </div>
    )
  }

  // ── Desktop layout: info sidebar + video grid ───────────────────────────
  return (
    <div ref={containerRef} className="ac ac--desktop">
      <div className="ac__split">
        <div className="ac__d-info">
          <div className="ac__avatar ac__avatar--72">{contactInitial}</div>
          <span className="ac__name ac__name--16">{contactName}</span>
          <span className="ac__timer">{duration}</span>
          {encrypted && (
            <span className="ac__d-encrypt">HD · Encrypted</span>
          )}

          <div className="ac__separator" />

          <span className="ac__section-label">PARTICIPANTS</span>
          <div className="ac__participant-list">
            {(participants.length > 0 ? participants : [
              { id: 'self', name: contactName, initial: contactInitial, muted: false },
            ]).map((p) => (
              <div key={p.id} className="ac__participant-row">
                <div className="ac__participant-avatar">{p.initial}</div>
                <span className="ac__participant-name">{p.name}</span>
                {p.muted ? (
                  <MicOffIcon width={14} height={14} />
                ) : (
                  <MicIcon width={14} height={14} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="ac__d-main">
          <div className="ac__d-grid">
            {/* Remote video tiles */}
            {remoteCameraOn && remoteStream ? (
              <div className="ac__d-tile">
                <video
                  ref={remoteVideoRef}
                  className="ac__d-tile-video"
                  autoPlay
                  playsInline
                />
                <div className="ac__vid-label ac__vid-label--tile">
                  <MicIcon width={12} height={12} />
                  <span>{contactName}</span>
                </div>
              </div>
            ) : (
              <div className="ac__d-tile ac__d-tile--empty">
                <div className="ac__camera-off">
                  <VideoIcon width={40} height={40} />
                  <span>Waiting for video…</span>
                </div>
              </div>
            )}

            {/* Additional participant placeholders */}
            {participants.filter((p) => p.id !== 'self').map((p) => (
              <div key={p.id} className="ac__d-tile ac__d-tile--empty">
                <div className="ac__camera-off">
                  <VideoIcon width={32} height={32} />
                </div>
                <div className="ac__vid-label ac__vid-label--tile">
                  <MicIcon width={12} height={12} />
                  <span>{p.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {controlsBar}
    </div>
  )
}
