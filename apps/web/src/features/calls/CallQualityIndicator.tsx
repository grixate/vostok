type CallQualityIndicatorProps = {
  quality: 'good' | 'fair' | 'poor' | 'reconnecting'
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
