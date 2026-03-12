import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  toAttachmentDescriptor,
  isVoiceNoteAttachment,
  isRoundVideoAttachment
} from '../../utils/attachment-helpers.ts'
import { extractFirstHttpUrl } from '../../utils/format.ts'
import type { CachedMessage } from '../../lib/message-cache.ts'
import type { useMediaCapture } from '../../hooks/useMediaCapture.ts'

type MediaGalleryProps = {
  messageItems: CachedMessage[]
  media: ReturnType<typeof useMediaCapture>
}

type MediaTab = 'photos' | 'files' | 'links' | 'voice'

const INITIAL_VISIBLE_COUNT = 12
const LOAD_MORE_COUNT = 12

export function MediaGallery({ messageItems, media }: MediaGalleryProps) {
  const [activeTab, setActiveTab] = useState<MediaTab>('photos')
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Reset visible count on tab change
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT)
  }, [activeTab])

  const photoItems = useMemo(
    () =>
      messageItems
        .filter(
          (m) =>
            m.attachment?.thumbnailDataUrl &&
            !isVoiceNoteAttachment(m.attachment) &&
            !isRoundVideoAttachment(m.attachment)
        )
        .reverse(),
    [messageItems]
  )

  const fileItems = useMemo(
    () =>
      messageItems
        .filter(
          (m) =>
            m.attachment &&
            !m.attachment.thumbnailDataUrl &&
            !isVoiceNoteAttachment(m.attachment) &&
            !isRoundVideoAttachment(m.attachment)
        )
        .reverse(),
    [messageItems]
  )

  const linkItems = useMemo(() => {
    const seen = new Set<string>()
    const links: { messageId: string; url: string; text: string }[] = []

    for (const m of [...messageItems].reverse()) {
      const url = extractFirstHttpUrl(m.text)
      if (url && !seen.has(url)) {
        seen.add(url)
        links.push({ messageId: m.id, url, text: m.text })
      }
    }

    return links
  }, [messageItems])

  const voiceItems = useMemo(
    () =>
      messageItems
        .filter((m) => m.attachment && isVoiceNoteAttachment(m.attachment))
        .reverse(),
    [messageItems]
  )

  // Lazy loading with IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => prev + LOAD_MORE_COUNT)
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [activeTab])

  const handleShowMore = useCallback(() => {
    setVisibleCount((prev) => prev + LOAD_MORE_COUNT)
  }, [])

  const tabs: { id: MediaTab; label: string; count: number }[] = [
    { id: 'photos', label: 'Photos', count: photoItems.length },
    { id: 'files', label: 'Files', count: fileItems.length },
    { id: 'links', label: 'Links', count: linkItems.length },
    { id: 'voice', label: 'Voice', count: voiceItems.length },
  ]

  return (
    <div className="media-gallery">
      <div className="media-gallery__tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={
              activeTab === tab.id
                ? 'media-gallery__tab media-gallery__tab--active'
                : 'media-gallery__tab'
            }
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.count > 0 ? (
              <span className="media-gallery__tab-count">{tab.count}</span>
            ) : null}
          </button>
        ))}
      </div>

      {activeTab === 'photos' ? (
        <div className="media-gallery__grid">
          {photoItems.slice(0, visibleCount).map((message) => (
            <button
              key={message.id}
              className="chat-media-gallery__item"
              type="button"
              onClick={() => {
                if (message.attachment?.contentKeyBase64 && message.attachment.ivBase64) {
                  void media.handleDownloadAttachment(toAttachmentDescriptor(message.attachment))
                }
              }}
            >
              {message.attachment?.thumbnailDataUrl ? (
                <img
                  alt={message.attachment.fileName}
                  className="chat-media-gallery__image"
                  src={message.attachment.thumbnailDataUrl}
                  loading="lazy"
                />
              ) : null}
            </button>
          ))}
          {photoItems.length > visibleCount ? (
            <div ref={sentinelRef} className="media-gallery__sentinel" />
          ) : null}
        </div>
      ) : null}

      {activeTab === 'files' ? (
        <div className="media-gallery__list">
          {fileItems.length === 0 ? (
            <span className="media-gallery__empty">No files shared</span>
          ) : null}
          {fileItems.slice(0, visibleCount).map((message) => (
            <button
              key={message.id}
              className="media-gallery__list-item"
              type="button"
              onClick={() => {
                if (message.attachment?.contentKeyBase64 && message.attachment.ivBase64) {
                  void media.handleDownloadAttachment(toAttachmentDescriptor(message.attachment))
                }
              }}
            >
              <span className="media-gallery__file-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M9 2H4C3.4 2 3 2.4 3 3V13C3 13.6 3.4 14 4 14H12C12.6 14 13 13.6 13 13V6L9 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M9 2V6H13" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="media-gallery__file-info">
                <strong>{message.attachment?.fileName ?? 'File'}</strong>
                <span>{formatFileSize(message.attachment?.size ?? 0)}</span>
              </span>
            </button>
          ))}
          {fileItems.length > visibleCount ? (
            <button className="media-gallery__show-more" type="button" onClick={handleShowMore}>
              Show more
            </button>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'links' ? (
        <div className="media-gallery__list">
          {linkItems.length === 0 ? (
            <span className="media-gallery__empty">No links shared</span>
          ) : null}
          {linkItems.slice(0, visibleCount).map((item) => {
            let hostname: string
            try {
              hostname = new URL(item.url).hostname.replace(/^www\./i, '')
            } catch {
              hostname = item.url
            }

            return (
              <a
                key={item.messageId}
                className="media-gallery__list-item media-gallery__link-item"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="media-gallery__link-icon">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M6.5 4H4C3 4 2 5 2 6V12C2 13 3 14 4 14H10C11 14 12 13 12 12V9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    <path d="M9 2H14V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 2L7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="media-gallery__file-info">
                  <strong>{hostname}</strong>
                  <span>{item.url}</span>
                </span>
              </a>
            )
          })}
          {linkItems.length > visibleCount ? (
            <button className="media-gallery__show-more" type="button" onClick={handleShowMore}>
              Show more
            </button>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'voice' ? (
        <div className="media-gallery__list">
          {voiceItems.length === 0 ? (
            <span className="media-gallery__empty">No voice notes shared</span>
          ) : null}
          {voiceItems.slice(0, visibleCount).map((message) => (
            <button
              key={message.id}
              className="media-gallery__list-item"
              type="button"
              onClick={() => {
                if (message.attachment?.contentKeyBase64 && message.attachment.ivBase64) {
                  void media.handleDownloadAttachment(toAttachmentDescriptor(message.attachment))
                }
              }}
            >
              <span className="media-gallery__file-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="6" y="1" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M3 8C3 10.8 5.2 13 8 13C10.8 13 13 10.8 13 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M8 13V15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </span>
              <span className="media-gallery__file-info">
                <strong>{message.attachment?.fileName ?? 'Voice note'}</strong>
                <span>{formatFileSize(message.attachment?.size ?? 0)}</span>
              </span>
            </button>
          ))}
          {voiceItems.length > visibleCount ? (
            <button className="media-gallery__show-more" type="button" onClick={handleShowMore}>
              Show more
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
