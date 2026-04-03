export type CallQuality = 'good' | 'fair' | 'poor' | 'reconnecting'

type CallQualityIndicatorProps = {
  quality: CallQuality
}

const TOOLTIPS: Record<string, string> = {
  good: 'Connection quality: Good',
  fair: 'Poor connection — video quality reduced',
  poor: 'Very poor connection — audio only',
  reconnecting: 'Reconnecting...',
}

export function CallQualityIndicator({ quality }: CallQualityIndicatorProps) {
  return (
    <span
      className={`call-quality call-quality--${quality}`}
      title={TOOLTIPS[quality]}
      aria-label={TOOLTIPS[quality]}
    />
  )
}
