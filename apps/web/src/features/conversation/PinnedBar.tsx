import { useState, useMemo, useCallback } from 'react'
import { resolvePinnedPreview } from '../../utils/format.ts'
import {
  PinSmallIcon,
  ChevronUpSmallIcon,
  ChevronDownSmallIcon,
  CloseSmallIcon,
} from '../../icons/index.tsx'
import type { CachedMessage } from '../../lib/message-cache.ts'

type PinnedBarProps = {
  messageItems: CachedMessage[]
  onScrollToMessage: (messageId: string) => void
}

export function PinnedBar({ messageItems, onScrollToMessage }: PinnedBarProps) {
  const [dismissed, setDismissed] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)

  const pinnedMessages = useMemo(() => {
    return messageItems
      .filter((message) => message.pinnedAt && !message.deletedAt)
      .sort((left, right) => {
        const leftTime = Date.parse(left.pinnedAt ?? left.sentAt)
        const rightTime = Date.parse(right.pinnedAt ?? right.sentAt)

        if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
          return (right.pinnedAt ?? right.sentAt).localeCompare(left.pinnedAt ?? left.sentAt)
        }

        return rightTime - leftTime
      })
  }, [messageItems])

  const handlePrevious = useCallback(() => {
    if (pinnedMessages.length === 0) return
    setCurrentIndex((prev) => (prev - 1 + pinnedMessages.length) % pinnedMessages.length)
  }, [pinnedMessages.length])

  const handleNext = useCallback(() => {
    if (pinnedMessages.length === 0) return
    setCurrentIndex((prev) => (prev + 1) % pinnedMessages.length)
  }, [pinnedMessages.length])

  if (dismissed || pinnedMessages.length === 0) {
    return null
  }

  const safeIndex = Math.min(currentIndex, pinnedMessages.length - 1)
  const currentPinned = pinnedMessages[safeIndex]

  return (
    <div
      className="pinned-bar"
      onClick={() => onScrollToMessage(currentPinned.id)}
    >
      <span className="pinned-bar__icon">
        <PinSmallIcon />
      </span>
      <div className="pinned-bar__content">
        {pinnedMessages.length > 1 ? (
          <span className="pinned-bar__counter">
            Pinned Message {safeIndex + 1} of {pinnedMessages.length}
          </span>
        ) : null}
        <span className="pinned-bar__text">{resolvePinnedPreview(currentPinned)}</span>
      </div>
      {pinnedMessages.length > 1 ? (
        <div className="pinned-bar__nav">
          <button type="button" aria-label="Previous pinned" onClick={(e) => { e.stopPropagation(); handlePrevious() }}>
            <ChevronUpSmallIcon />
          </button>
          <button type="button" aria-label="Next pinned" onClick={(e) => { e.stopPropagation(); handleNext() }}>
            <ChevronDownSmallIcon />
          </button>
        </div>
      ) : null}
      <button
        className="pinned-bar__close"
        type="button"
        aria-label="Dismiss pinned"
        onClick={(e) => { e.stopPropagation(); setDismissed(true) }}
      >
        <CloseSmallIcon />
      </button>
    </div>
  )
}
