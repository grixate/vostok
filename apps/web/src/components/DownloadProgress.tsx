import { X } from 'lucide-react'

type DownloadProgressProps = {
  progress: number // 0.0 to 1.0, -1 for indeterminate
  size?: number
  downloaded?: string
  total?: string
  onCancel: () => void
}

export function DownloadProgress({
  progress,
  size = 44,
  downloaded,
  total,
  onCancel,
}: DownloadProgressProps) {
  const radius = (size - 4) / 2
  const circumference = 2 * Math.PI * radius
  const isIndeterminate = progress < 0
  const dashOffset = isIndeterminate
    ? circumference * 0.75
    : circumference * (1 - Math.max(0, Math.min(1, progress)))

  return (
    <div
      className="download-progress"
      onClick={(e) => { e.stopPropagation(); onCancel() }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onCancel() } }}
      aria-label="Cancel download"
    >
      <div className="download-progress__ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={2.5}
          />
          {/* Progress arc */}
          <circle
            className={isIndeterminate ? 'download-progress__arc--spin' : ''}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#fff"
            strokeWidth={2.5}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <X size={size * 0.32} strokeWidth={2.5} className="download-progress__cancel" />
      </div>
      {downloaded && total ? (
        <span className="download-progress__label">{downloaded} / {total}</span>
      ) : null}
    </div>
  )
}
