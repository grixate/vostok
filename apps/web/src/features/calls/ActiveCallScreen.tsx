import { useRef, useEffect, useState } from 'react'
import { CallControls } from './CallControls.tsx'
import { SelfPreviewPiP } from './SelfPreviewPiP.tsx'
import { ScreenShareView } from './ScreenShareView.tsx'
import { CallQualityIndicator, type CallQuality } from './CallQualityIndicator.tsx'
import type { MediaDeviceOption } from '../../hooks/useMediaDevices.ts'
import { useCallTimer } from '../../hooks/useCallTimer.ts'
import {
  BackIcon,
  MicIcon,
  MicOffIcon,
  MoreVertIcon,
  VideoIcon,
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
  screenShareStream?: MediaStream | null
  statusLabel?: string
  showScreenControls?: boolean
  callQuality?: CallQuality
  audioDevices?: MediaDeviceOption[]
  videoDevices?: MediaDeviceOption[]
  participants?: Participant[]
  onToggleMute: () => void
  onToggleCamera: () => void
  onToggleScreen: () => void
  onSwitchDevice?: (deviceId: string, kind: 'audio' | 'video') => void
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
  screenShareStream,
  statusLabel,
  showScreenControls = false,
  callQuality,
  audioDevices = [],
  videoDevices = [],
  participants = [],
  onToggleMute,
  onToggleCamera,
  onToggleScreen,
  onSwitchDevice,
  onHangup,
  onBack,
}: ActiveCallScreenProps) {
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const duration = useCallTimer(true)
  const [layout, setLayout] = useState<'mobile' | 'tablet' | 'desktop'>('desktop')
  const containerRef = useRef<HTMLDivElement>(null)

  const showVideo = mode === 'video'
  const isGroup = participants.length > 1

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

  // ── Shared JSX fragments ──────────────────────────────────────────────

  const headerBar = (
    <div className="ac__header">
      <div className="ac__header-left">
        {onBack && (
          <button type="button" className="ac__back-btn" onClick={onBack}>
            <BackIcon width={18} height={18} />
          </button>
        )}
        <div className="ac__avatar ac__avatar--36">{contactInitial}</div>
        <span className="ac__header-name">{contactName}</span>
        {callQuality ? <CallQualityIndicator quality={callQuality} /> : <span className="ac__status-dot" />}
        {statusLabel ? <span className="ac__timer">{statusLabel}</span> : null}
      </div>
      <div className="ac__header-right">
        <button type="button" className="ac__menu-btn" aria-label="More options">
          <MoreVertIcon width={20} height={20} />
        </button>
      </div>
    </div>
  )

  const floatingHeader = (
    <div className="ac__floating-header">
      <div className="ac__avatar ac__avatar--36">{contactInitial}</div>
      <div className="ac__floating-header-info">
        <div className="ac__floating-header-top">
          <span className="ac__header-name">{contactName}</span>
          {callQuality ? <CallQualityIndicator quality={callQuality} /> : <span className="ac__status-dot" />}
        </div>
        <span className="ac__timer">{statusLabel ?? duration}</span>
      </div>
    </div>
  )

  const controlProps = {
    muted,
    cameraOn,
    screenSharing,
    showCamera: showVideo,
    showScreen: showScreenControls,
    audioDevices,
    videoDevices,
    onToggleMute,
    onToggleCamera,
    onToggleScreen,
    onSwitchDevice,
    onHangup,
  } as const

  const floatingControls = (
    <div className="ac__controls-floating">
      <CallControls {...controlProps} />
    </div>
  )

  const controlsArea = (
    <div className="ac__controls-area">
      <CallControls {...controlProps} />
    </div>
  )

  const remoteVideoOrPlaceholder = remoteCameraOn && remoteStream ? (
    <video
      ref={remoteVideoRef}
      className="ac__remote-video"
      autoPlay
      playsInline
    />
  ) : (
    <div className="ac__remote-placeholder">
      <div className="ac__avatar ac__avatar--96">{contactInitial}</div>
      <span className="ac__name ac__name--20">{contactName}</span>
      {showVideo && <span className="ac__placeholder-hint">Waiting for video…</span>}
    </div>
  )

  const selfPiP = localStream && cameraOn ? (
    <SelfPreviewPiP stream={localStream} />
  ) : null

  const screenShareArea = screenSharing && screenShareStream ? (
    <ScreenShareView
      stream={screenShareStream}
      presenterName="You"
      isSelf={true}
      onStopSharing={onToggleScreen}
    />
  ) : null

  const groupTiles = (
    <>
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
          </div>
          <div className="ac__vid-label ac__vid-label--tile">
            <MicIcon width={12} height={12} />
            <span>{contactName}</span>
          </div>
        </div>
      )}
      {participants.filter((p) => p.id !== 'self').map((p) => (
        <div key={p.id} className="ac__d-tile ac__d-tile--empty">
          <div className="ac__camera-off">
            <div className="ac__avatar ac__avatar--40">{p.initial}</div>
          </div>
          <div className="ac__vid-label ac__vid-label--tile">
            {p.muted ? (
              <MicOffIcon width={12} height={12} />
            ) : (
              <MicIcon width={12} height={12} />
            )}
            <span>{p.name}</span>
          </div>
        </div>
      ))}
    </>
  )

  // ── Mobile layout ───────────────────────────────────────────────────────
  if (layout === 'mobile') {
    if (isGroup) {
      return (
        <div ref={containerRef} className="ac ac--mobile">
          {headerBar}
          <div className="ac__video-area">
            <div className="ac__group-stacked">
              {groupTiles}
            </div>
          </div>
          {controlsArea}
        </div>
      )
    }

    return (
      <div ref={containerRef} className="ac ac--mobile">
        <div className="ac__video-area">
          {screenShareArea ?? remoteVideoOrPlaceholder}
          {floatingHeader}
          {selfPiP}
          {floatingControls}
        </div>
      </div>
    )
  }

  // ── Tablet layout ───────────────────────────────────────────────────────
  if (layout === 'tablet') {
    if (isGroup) {
      return (
        <div ref={containerRef} className="ac ac--tablet">
          {headerBar}
          <div className="ac__video-area">
            <div className="ac__group-stacked">
              {groupTiles}
            </div>
          </div>
          {controlsArea}
        </div>
      )
    }

    return (
      <div ref={containerRef} className="ac ac--tablet">
        <div className="ac__video-area">
          {screenShareArea ?? remoteVideoOrPlaceholder}
          {floatingHeader}
          {selfPiP}
          {floatingControls}
        </div>
      </div>
    )
  }

  // ── Desktop layout ──────────────────────────────────────────────────────
  if (isGroup) {
    return (
      <div ref={containerRef} className="ac ac--desktop">
        {headerBar}
        <div className="ac__video-area">
          {screenShareArea ?? (
            <div className="ac__group-grid">
              {groupTiles}
            </div>
          )}
        </div>
        {controlsArea}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="ac ac--desktop">
      {headerBar}
      <div className="ac__video-area">
        {screenShareArea ?? remoteVideoOrPlaceholder}
        {selfPiP}
        {floatingControls}
      </div>
    </div>
  )
}
