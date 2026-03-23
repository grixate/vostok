import { PhoneIcon, PhoneOffIcon } from '../../icons/index.tsx'

type IncomingCallBannerProps = {
  callerName: string
  callerInitial: string
  callType: 'voice' | 'video'
  onAccept: () => void
  onDecline: () => void
}

export function IncomingCallBanner({
  callerName,
  callerInitial,
  callType,
  onAccept,
  onDecline,
}: IncomingCallBannerProps) {
  return (
    <div className="incoming-call-banner">
      <div className="incoming-call-banner__avatar">
        {callerInitial}
      </div>
      <div className="incoming-call-banner__info">
        <span className="incoming-call-banner__name">{callerName}</span>
        <span className="incoming-call-banner__subtitle">
          Incoming {callType} call...
        </span>
      </div>
      <div className="incoming-call-banner__actions">
        <button
          type="button"
          className="incoming-call-banner__btn incoming-call-banner__btn--decline"
          onClick={onDecline}
          aria-label="Decline call"
        >
          <PhoneOffIcon width={18} height={18} />
        </button>
        <button
          type="button"
          className="incoming-call-banner__btn incoming-call-banner__btn--accept"
          onClick={onAccept}
          aria-label="Accept call"
        >
          <PhoneIcon width={18} height={18} />
        </button>
      </div>
    </div>
  )
}
