import { PhoneIcon, PhoneOffIcon } from '../../icons/index.tsx'

type IncomingCallOverlayProps = {
  callerName: string
  callerInitial: string
  callType: 'voice' | 'video'
  onAccept: () => void
  onDecline: () => void
}

export function IncomingCallOverlay({
  callerName,
  callerInitial,
  callType,
  onAccept,
  onDecline,
}: IncomingCallOverlayProps) {
  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-overlay__card">
        <div className="incoming-call-overlay__avatar">
          {callerInitial}
        </div>
        <span className="incoming-call-overlay__name">{callerName}</span>
        <span className="incoming-call-overlay__subtitle">
          Incoming {callType} call
        </span>
        <div className="incoming-call-overlay__actions">
          <button
            type="button"
            className="incoming-call-overlay__action-btn incoming-call-overlay__action-btn--decline"
            onClick={onDecline}
            aria-label="Decline call"
          >
            <PhoneOffIcon width={24} height={24} />
          </button>
          <button
            type="button"
            className="incoming-call-overlay__action-btn incoming-call-overlay__action-btn--accept"
            onClick={onAccept}
            aria-label="Accept call"
          >
            <PhoneIcon width={24} height={24} />
          </button>
        </div>
      </div>
    </div>
  )
}
