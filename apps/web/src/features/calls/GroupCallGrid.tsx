import { ParticipantTile } from './ParticipantTile.tsx'
import { CallControls } from './CallControls.tsx'
import { useCallTimer } from '../../hooks/useCallTimer.ts'
import { useGridLayout } from '../../hooks/useGridLayout.ts'
import { BackIcon } from '../../icons/index.tsx'

export type GroupParticipant = {
  userId: string
  name: string
  initial: string
  stream: MediaStream | null
  videoEnabled: boolean
  audioMuted: boolean
  isSpeaking: boolean
  connectionQuality?: 'good' | 'fair' | 'poor'
}

type GroupCallGridProps = {
  participants: GroupParticipant[]
  muted: boolean
  cameraOn: boolean
  screenSharing: boolean
  onToggleMute: () => void
  onToggleCamera: () => void
  onToggleScreen: () => void
  onHangup: () => void
  onMinimize?: () => void
}

export function GroupCallGrid({
  participants,
  muted,
  cameraOn,
  screenSharing,
  onToggleMute,
  onToggleCamera,
  onToggleScreen,
  onHangup,
  onMinimize,
}: GroupCallGridProps) {
  const duration = useCallTimer(true)
  const grid = useGridLayout(participants.length)

  return (
    <div className="active-video-call">
      {onMinimize && (
        <button type="button" className="outgoing-call-screen__back" onClick={onMinimize}>
          <BackIcon width={16} height={16} />
          Back to chat
        </button>
      )}

      <div className="active-video-call__info-overlay">
        <div className="active-video-call__info-text">
          <span className="active-video-call__info-name">
            Group call · {participants.length} participants
          </span>
          <span className="active-video-call__info-duration">{duration}</span>
        </div>
      </div>

      <div
        className="group-call-grid"
        style={{ gridTemplateColumns: grid.template }}
      >
        {participants.map((p) => (
          <ParticipantTile
            key={p.userId}
            name={p.name}
            initial={p.initial}
            stream={p.stream}
            videoEnabled={p.videoEnabled}
            audioMuted={p.audioMuted}
            isSpeaking={p.isSpeaking}
            connectionQuality={p.connectionQuality}
          />
        ))}
      </div>

      <div className="active-video-call__gradient" />
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
