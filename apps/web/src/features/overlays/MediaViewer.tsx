import { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Download, Share2, Trash2 } from 'lucide-react'
import { t } from '../../lib/i18n.ts'
import '../../styles/media-viewer.css'

type MediaViewerProps = {
  items: Array<{
    url: string
    type: 'image' | 'video'
    senderName: string
    timestamp: string
    fileName: string
  }>
  initialIndex: number
  onClose: () => void
  onDownload?: (index: number) => void
}

export function MediaViewer({ items, initialIndex, onClose, onDownload }: MediaViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)

  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < items.length - 1
  const item = items[currentIndex]

  const goToPrev = useCallback(() => {
    setCurrentIndex((i) => (i > 0 ? i - 1 : i))
  }, [])

  const goToNext = useCallback(() => {
    setCurrentIndex((i) => (i < items.length - 1 ? i + 1 : i))
  }, [items.length])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      } else if (event.key === 'ArrowLeft') {
        goToPrev()
      } else if (event.key === 'ArrowRight') {
        goToNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, goToPrev, goToNext])

  function handleContentBackdropClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  if (!item) {
    return null
  }

  return (
    <div className="media-viewer">
      <div className="media-viewer__topbar">
        <span className="media-viewer__sender">{item.senderName}</span>
        <span className="media-viewer__timestamp">{item.timestamp}</span>
        <div className="media-viewer__topbar-spacer" />
        <button className="media-viewer__close" type="button" onClick={onClose} aria-label={t('close')}>
          <X size={14} />
        </button>
      </div>

      <div className="media-viewer__content" onClick={handleContentBackdropClick}>
        {item.type === 'image' ? (
          <img
            className="media-viewer__image"
            src={item.url}
            alt={item.fileName}
            draggable={false}
          />
        ) : (
          <video
            className="media-viewer__video"
            src={item.url}
            controls
            autoPlay
            key={item.url}
          />
        )}

        {hasPrev ? (
          <button
            className="media-viewer__nav media-viewer__nav--prev"
            type="button"
            onClick={goToPrev}
            aria-label={t('previous')}
          >
            <ChevronLeft size={20} />
          </button>
        ) : null}

        {hasNext ? (
          <button
            className="media-viewer__nav media-viewer__nav--next"
            type="button"
            onClick={goToNext}
            aria-label={t('next')}
          >
            <ChevronRight size={20} />
          </button>
        ) : null}
      </div>

      <div className="media-viewer__bottombar">
        <span className="media-viewer__counter">{t('media_counter', currentIndex + 1, items.length)}</span>
        <div className="media-viewer__actions">
          <button
            className="media-viewer__action-btn"
            type="button"
            onClick={() => onDownload?.(currentIndex)}
            aria-label={t('download')}
          >
            <Download size={20} />
          </button>
          <button className="media-viewer__action-btn" type="button" aria-label={t('forward')}>
            <Share2 size={20} />
          </button>
          <button className="media-viewer__action-btn media-viewer__action-btn--muted" type="button" aria-label={t('delete')}>
            <Trash2 size={20} />
          </button>
        </div>
      </div>
    </div>
  )
}
