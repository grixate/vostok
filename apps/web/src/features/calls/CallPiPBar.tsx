import {
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  ExpandIcon,
  PhoneOffIcon,
} from '../../icons/index.tsx'

type CallPiPBarProps = {
  contactName: string
  duration: string
  muted: boolean
  cameraOn?: boolean
  emojiFingerprint?: string
  onToggleMute: () => void
  onToggleCamera?: () => void
  onHangup: () => void
  onExpand: () => void
}

export function CallPiPBar({
  contactName,
  duration,
  muted,
  cameraOn = false,
  emojiFingerprint,
  onToggleMute,
  onToggleCamera,
  onHangup,
  onExpand,
}: CallPiPBarProps) {
  const emoji = emojiFingerprint || '🐻🦊🐱🐶'

  return (
    <div className="active-call-bar">
      <div className="active-call-bar__left" onClick={onExpand} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand() } }}>
        <span className="active-call-bar__pulse" />
        <span className="active-call-bar__text">
          {contactName} · {duration}
        </span>
        <span className="active-call-bar__emoji">{emoji}</span>
      </div>

      <div className="active-call-bar__right" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="active-call-bar__btn"
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <MicOffIcon width={14} height={14} /> : <MicIcon width={14} height={14} />}
        </button>
        {onToggleCamera && (
          <button
            type="button"
            className="active-call-bar__btn"
            onClick={onToggleCamera}
            aria-label={cameraOn ? 'Camera off' : 'Camera on'}
          >
            {cameraOn ? <VideoIcon width={14} height={14} /> : <VideoOffIcon width={14} height={14} />}
          </button>
        )}
        <button
          type="button"
          className="active-call-bar__btn"
          onClick={onExpand}
          aria-label="Expand call"
        >
          <ExpandIcon width={14} height={14} />
        </button>
        <button
          type="button"
          className="active-call-bar__btn active-call-bar__btn--hangup"
          onClick={onHangup}
          aria-label="End call"
        >
          <PhoneOffIcon width={14} height={14} />
        </button>
      </div>
    </div>
  )
}
