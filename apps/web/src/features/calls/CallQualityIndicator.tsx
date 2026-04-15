import type {
  CallQualityIndicator as CallQuality,
  CallQualityProfile,
  CallTransportStatus
} from '../../lib/call-quality-policy.ts'
import { t } from '../../lib/i18n.ts'

type CallQualityIndicatorProps = {
  transportStatus: CallTransportStatus
  quality: CallQuality
  profile?: CallQualityProfile
}

const PROFILE_LABEL_KEYS: Record<CallQualityProfile, string> = {
  high: 'high_quality',
  medium: 'balanced_quality',
  low: 'low_bandwidth_video',
  audio_fallback: 'audio_priority_mode',
}

function transportStatusLabel(status: CallTransportStatus): string {
  switch (status) {
    case 'connected':
      return t('transport_connected')
    case 'reconnecting':
      return t('transport_reconnecting')
    case 'disconnected':
      return t('transport_disconnected')
    default:
      return t('transport_unknown')
  }
}

function qualityStatusLabel(quality: CallQuality, profile?: CallQualityProfile): string {
  const profileLabel = profile ? ` (${t(PROFILE_LABEL_KEYS[profile])})` : ''

  switch (quality) {
    case 'good':
      return `${t('media_quality_good')}${profileLabel}`
    case 'fair':
      return `${t('media_quality_constrained')}${profileLabel}`
    case 'poor':
      return profile === 'audio_fallback'
        ? `${t('media_quality_poor')} (${t('audio_priority')})`
        : `${t('media_quality_poor')}${profileLabel}`
    default:
      return t('media_quality_unavailable')
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
