import { CallControls } from './CallControls.tsx'

type OutgoingCallScreenProps = {
  contactName: string
  contactInitial: string
  status: string
  muted: boolean
  onToggleMute: () => void
  onHangup: () => void
}

export function OutgoingCallScreen({
  contactName,
  contactInitial,
  status,
  muted,
  onToggleMute,
  onHangup,
}: OutgoingCallScreenProps) {
  return (
    <div className="outgoing-call-screen">
      <div className="outgoing-call-screen__body">
        <div className="outgoing-call-screen__avatar">
          {contactInitial}
        </div>
        <span className="outgoing-call-screen__name">{contactName}</span>
        <span className="outgoing-call-screen__status">{status}</span>
      </div>

      <div className="outgoing-call-screen__controls">
        <CallControls
          muted={muted}
          cameraOn={false}
          screenSharing={false}
          onToggleMute={onToggleMute}
          onHangup={onHangup}
        />
      </div>
    </div>
  )
}
