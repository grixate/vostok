import { ArrowDown } from 'lucide-react'
import { formatBytes } from '../lib/client-storage.ts'

type DownloadArrowProps = {
  size?: number
  fileSize: number
  duration?: string
  onTap: () => void
  variant?: 'overlay' | 'standalone'
}

export function DownloadArrow({
  size = 44,
  fileSize,
  duration,
  onTap,
  variant = 'overlay',
}: DownloadArrowProps) {
  return (
    <div
      className={`download-arrow download-arrow--${variant}`}
      onClick={(e) => { e.stopPropagation(); onTap() }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onTap() } }}
      aria-label={`Download (${formatBytes(fileSize)})`}
    >
      <div
        className="download-arrow__circle"
        style={{ width: size, height: size }}
      >
        <ArrowDown size={size * 0.45} strokeWidth={2.5} />
      </div>
      <span className="download-arrow__label">
        {formatBytes(fileSize)}
        {duration ? ` \u00b7 ${duration}` : ''}
      </span>
    </div>
  )
}
