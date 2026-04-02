import type { StorageBreakdown, StorageCategory } from '../lib/storage-tracker.ts'
import { formatBytes } from '../lib/client-storage.ts'

type StorageBarProps = {
  breakdown: StorageBreakdown
  limitBytes: number
}

const CATEGORY_COLORS: Record<StorageCategory, string> = {
  photos: '#34C759',
  videos: '#5856D6',
  files: '#FF9500',
  voice_messages: '#FF2D55',
  round_videos: '#AF52DE',
  other: '#8E8E93',
}

const CATEGORY_LABELS: Record<StorageCategory, string> = {
  photos: 'Photos',
  videos: 'Videos',
  files: 'Files',
  voice_messages: 'Voice Messages',
  round_videos: 'Round Videos',
  other: 'Other',
}

export function StorageBar({ breakdown, limitBytes }: StorageBarProps) {
  const total = breakdown.total_bytes
  const limit = limitBytes > 0 ? limitBytes : total * 2 || 1
  const categories = (Object.keys(CATEGORY_COLORS) as StorageCategory[])
    .filter((cat) => (breakdown.by_category[cat] ?? 0) > 0)

  return (
    <div className="storage-bar">
      <div className="storage-bar__track">
        {categories.map((cat) => {
          const bytes = breakdown.by_category[cat] ?? 0
          const pct = (bytes / limit) * 100
          return (
            <div
              key={cat}
              className="storage-bar__segment"
              style={{ width: `${Math.max(pct, 0.5)}%`, background: CATEGORY_COLORS[cat] }}
              title={`${CATEGORY_LABELS[cat]}: ${formatBytes(bytes)}`}
            />
          )
        })}
      </div>
      <span className="storage-bar__total">
        {formatBytes(total)} {limitBytes > 0 ? `of ${formatBytes(limitBytes)}` : ''} used
      </span>
      {categories.length > 0 && (
        <div className="storage-bar__legend">
          {categories.map((cat) => (
            <div key={cat} className="storage-bar__legend-row">
              <span className="storage-bar__legend-dot" style={{ background: CATEGORY_COLORS[cat] }} />
              <span className="storage-bar__legend-label">{CATEGORY_LABELS[cat]}</span>
              <span className="storage-bar__legend-size">{formatBytes(breakdown.by_category[cat] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
