import { createPortal } from 'react-dom'
import { CloseIcon } from '../../icons/index.tsx'
import { t } from '../../lib/i18n.ts'

type CallEndedScreenProps = {
  contactName: string
  contactInitial: string
  endReason: string
  duration: string
  onClose: () => void
}

function endReasonLabel(reason: string): string {
  switch (reason) {
    case 'normal': return t('call_ended')
    case 'declined': return t('call_declined')
    case 'busy': return t('call_busy')
    case 'timeout': return t('call_no_answer')
    case 'failed': return t('call_failed')
    case 'missed': return t('call_missed')
    default: return t('call_ended')
  }
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
          aria-label={t('dismiss')}
        >
          <CloseIcon />
        </button>
        <div className="call-ended-dialog__avatar">{contactInitial}</div>
        <span className="call-ended-dialog__name">{contactName}</span>
        <span className="call-ended-dialog__reason">
          {endReasonLabel(endReason)}
        </span>
        {duration && duration !== '0:00' && (
          <span className="call-ended-dialog__duration">{duration}</span>
        )}
      </div>
    </div>,
    document.body
  )
}
