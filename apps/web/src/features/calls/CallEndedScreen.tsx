import { createPortal } from 'react-dom'
import { CloseIcon } from '../../icons/index.tsx'

type CallEndedScreenProps = {
  contactName: string
  contactInitial: string
  endReason: string
  duration: string
  onClose: () => void
}

const END_REASON_LABELS: Record<string, string> = {
  normal: 'Call ended',
  declined: 'Call declined',
  busy: 'Busy',
  timeout: 'No answer',
  failed: 'Call failed',
  missed: 'Missed call',
}

export function CallEndedScreen({
  contactName,
  contactInitial,
  endReason,
  duration,
  onClose,
}: CallEndedScreenProps) {
  return createPortal(
    <div className="call-ended-dialog" role="dialog" aria-modal="true">
      <div className="call-ended-dialog__card">
        <button
          type="button"
          className="call-ended-dialog__close-btn"
          onClick={onClose}
          aria-label="Dismiss"
        >
          <CloseIcon />
        </button>
        <div className="call-ended-dialog__avatar">{contactInitial}</div>
        <span className="call-ended-dialog__name">{contactName}</span>
        <span className="call-ended-dialog__reason">
          {END_REASON_LABELS[endReason] ?? 'Call ended'}
        </span>
        {duration && duration !== '0:00' && (
          <span className="call-ended-dialog__duration">{duration}</span>
        )}
      </div>
    </div>,
    document.body
  )
}
