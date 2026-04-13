import type {
  CallQualityIndicator as CallQuality,
  CallQualityProfile,
  CallTransportStatus
} from '../../lib/call-quality-policy.ts'

type CallQualityIndicatorProps = {
  transportStatus: CallTransportStatus
  quality: CallQuality
  profile?: CallQualityProfile
}

const PROFILE_LABELS: Record<CallQualityProfile, string> = {
  high: 'High quality',
  medium: 'Balanced quality',
  low: 'Low-bandwidth video',
  audio_fallback: 'Audio-priority mode'
}

function transportStatusLabel(status: CallTransportStatus): string {
  switch (status) {
    case 'connected':
      return 'Transport: Connected'
    case 'reconnecting':
      return 'Transport: Reconnecting'
    case 'disconnected':
      return 'Transport: Disconnected'
    default:
      return 'Transport: Unknown'
  }
}

function qualityStatusLabel(quality: CallQuality, profile?: CallQualityProfile): string {
  const profileLabel = profile ? ` (${PROFILE_LABELS[profile]})` : ''

  switch (quality) {
    case 'good':
      return `Media quality: Good${profileLabel}`
    case 'fair':
      return `Media quality: Constrained${profileLabel}`
    case 'poor':
      return profile === 'audio_fallback'
        ? 'Media quality: Poor (Audio-priority mode active)'
        : `Media quality: Poor${profileLabel}`
    default:
      return 'Media quality: Unavailable'
  }
}

export function CallQualityIndicator({
  transportStatus,
  quality,
  profile
}: CallQualityIndicatorProps) {
  const transportTooltip = transportStatusLabel(transportStatus)
  const qualityTooltip = qualityStatusLabel(quality, profile)

  return (
    <span className="call-indicators" aria-hidden="false">
      <span
        className={`call-transport-dot call-transport-dot--${transportStatus}`}
        role="img"
        title={transportTooltip}
        aria-label={transportTooltip}
      />
      <span
        className={`call-quality-wave call-quality-wave--${quality}`}
        role="img"
        title={qualityTooltip}
        aria-label={qualityTooltip}
      >
        <span className="call-quality-wave__bar" />
        <span className="call-quality-wave__bar" />
        <span className="call-quality-wave__bar" />
        <span className="call-quality-wave__bar" />
      </span>
    </span>
  )
}
