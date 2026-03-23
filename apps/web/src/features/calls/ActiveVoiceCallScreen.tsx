import { CallControls } from './CallControls.tsx'
import { useCallTimer } from '../../hooks/useCallTimer.ts'
import { useProfilePhoto } from '../../hooks/useProfilePhotos.ts'
import { BackIcon } from '../../icons/index.tsx'

type ActiveVoiceCallScreenProps = {
  contactName: string
  contactInitial: string
  contactUserId?: string | null
  muted: boolean
  onToggleMute: () => void
  onToggleScreen: () => void
  screenSharing: boolean
  onHangup: () => void
  onMinimize?: () => void
}

export function ActiveVoiceCallScreen({
  contactName,
  contactInitial,
  contactUserId,
  muted,
  onToggleMute,
  onToggleScreen,
  screenSharing,
  onHangup,
  onMinimize,
}: ActiveVoiceCallScreenProps) {
  const duration = useCallTimer(true)
  const photoUrl = useProfilePhoto(contactUserId)

  return (
    <div className="call-screen">
      {/* Header: timer top-left */}
      <div className="call-screen__header">
        {onMinimize && (
          <button type="button" className="call-screen__back" onClick={onMinimize} aria-label="Back to chat">
            <BackIcon width={16} height={16} />
          </button>
        )}
        <span className="call-screen__header-timer">{duration} — VOICE</span>
      </div>

      {/* Left column: avatar + name + status */}
      <div className="call-screen__left">
        <div className="call-screen__avatar">
          {photoUrl ? (
            <img src={photoUrl} alt={contactName} className="call-screen__avatar-img" />
          ) : (
            contactInitial
          )}
        </div>
        <span className="call-screen__name">{contactName}</span>
        <span className="call-screen__status">{duration}</span>
      </div>

      {/* Right area: empty for voice calls */}
      <div className="call-screen__right" />

      {/* Controls: bottom-left */}
      <div className="call-screen__controls">
        <CallControls
          muted={muted}
          cameraOn={false}
          screenSharing={screenSharing}
          showCamera={false}
          onToggleMute={onToggleMute}
          onToggleScreen={onToggleScreen}
          onHangup={onHangup}
        />
      </div>
    </div>
  )
}
