import {
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  MonitorUpIcon,
  PhoneOffIcon,
} from '../../icons/index.tsx'

type CallControlsProps = {
  muted: boolean
  cameraOn: boolean
  screenSharing: boolean
  showCamera?: boolean
  showScreen?: boolean
  onToggleMute: () => void
  onToggleCamera?: () => void
  onToggleScreen?: () => void
  onHangup: () => void
}

export function CallControls({
  muted,
  cameraOn,
  screenSharing,
  showCamera = true,
  showScreen = true,
  onToggleMute,
  onToggleCamera,
  onToggleScreen,
  onHangup,
}: CallControlsProps) {
  return (
    <div className="call-controls">
      <button
        type="button"
        className={`call-controls__btn${muted ? ' call-controls__btn--active' : ''}`}
        onClick={onToggleMute}
        aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
        aria-pressed={muted}
      >
        {muted ? <MicOffIcon width={22} height={22} /> : <MicIcon width={22} height={22} />}
      </button>

      {showCamera && (
        <button
          type="button"
          className={`call-controls__btn${!cameraOn ? ' call-controls__btn--active' : ''}`}
          onClick={onToggleCamera}
          aria-label={cameraOn ? 'Turn off camera' : 'Turn on camera'}
          aria-pressed={!cameraOn}
        >
          {cameraOn ? <VideoIcon width={22} height={22} /> : <VideoOffIcon width={22} height={22} />}
        </button>
      )}

      {showScreen && (
        <button
          type="button"
          className={`call-controls__btn${screenSharing ? ' call-controls__btn--active' : ''}`}
          onClick={onToggleScreen}
          aria-label={screenSharing ? 'Stop screen sharing' : 'Share screen'}
          aria-pressed={screenSharing}
        >
          <MonitorUpIcon width={22} height={22} />
        </button>
      )}

      <button
        type="button"
        className="call-controls__btn call-controls__btn--hangup"
        onClick={onHangup}
        aria-label="End call"
      >
        <PhoneOffIcon width={22} height={22} />
      </button>
    </div>
  )
}
