type CallEndedScreenProps = {
  contactName: string
  contactInitial: string
  endReason: string
  duration: string
}

const END_REASON_LABELS: Record<string, string> = {
  normal: 'Call ended',
  declined: 'Call declined',
  busy: 'Busy',
  timeout: 'No answer',
  failed: 'Call failed',
  missed: 'Missed call',
}

// Parent controls dismiss via its own timer — this component is pure UI.
export function CallEndedScreen({
  contactName,
  contactInitial,
  endReason,
  duration,
}: CallEndedScreenProps) {
  return (
    <div className="call-ended-screen">
      <div className="call-ended-screen__avatar">
        {contactInitial}
      </div>
      <span className="call-ended-screen__name">{contactName}</span>
      <span className="call-ended-screen__reason">
        {END_REASON_LABELS[endReason] ?? 'Call ended'}
      </span>
      {duration && duration !== '0:00' && (
        <span className="call-ended-screen__duration">{duration}</span>
      )}
    </div>
  )
}
