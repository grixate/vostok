import { useRef, useEffect } from 'react'
import { CallControls } from './CallControls.tsx'
import { SelfPreviewPiP } from './SelfPreviewPiP.tsx'
import { useCallTimer } from '../../hooks/useCallTimer.ts'
import { VideoOffIcon } from '../../icons/index.tsx'

type ActiveVideoCallScreenProps = {
  contactName: string
  contactInitial: string
  remoteStream: MediaStream | null
  localStream: MediaStream | null
  remoteCameraOn: boolean
  muted: boolean
  cameraOn: boolean
  screenSharing: boolean
  onToggleMute: () => void
  onToggleCamera: () => void
  onToggleScreen: () => void
  onHangup: () => void
}

export function ActiveVideoCallScreen({
  contactName,
  contactInitial,
  remoteStream,
  localStream,
  remoteCameraOn,
  muted,
  cameraOn,
  screenSharing,
  onToggleMute,
  onToggleCamera,
  onToggleScreen,
  onHangup,
}: ActiveVideoCallScreenProps) {
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const duration = useCallTimer(true)

  useEffect(() => {
    const el = remoteVideoRef.current
    if (el && remoteStream) {
      el.srcObject = remoteStream
    }
    return () => {
      if (el) el.srcObject = null
    }
  }, [remoteStream])

  return (
    <div className="active-video-call">
      {/* Info overlay */}
      <div className="active-video-call__info-overlay">
        <div className="active-video-call__info-avatar">
          {contactInitial}
        </div>
        <div className="active-video-call__info-text">
          <span className="active-video-call__info-name">{contactName}</span>
          <span className="active-video-call__info-duration">{duration}</span>
        </div>
      </div>

      {/* Remote video area */}
      <div className="active-video-call__remote">
        {remoteCameraOn && remoteStream ? (
          <video
            ref={remoteVideoRef}
            className="active-video-call__remote-video"
            autoPlay
            playsInline
          />
        ) : (
          <div className="active-video-call__camera-off">
            <VideoOffIcon width={48} height={48} />
            <span>Camera off</span>
          </div>
        )}
      </div>

      {/* Self preview */}
      {localStream && cameraOn && (
        <SelfPreviewPiP stream={localStream} />
      )}

      {/* Gradient backdrop for controls */}
      <div className="active-video-call__gradient" />

      {/* Controls */}
      <div className="active-video-call__controls">
        <CallControls
          muted={muted}
          cameraOn={cameraOn}
          screenSharing={screenSharing}
          onToggleMute={onToggleMute}
          onToggleCamera={onToggleCamera}
          onToggleScreen={onToggleScreen}
          onHangup={onHangup}
        />
      </div>
    </div>
  )
}
