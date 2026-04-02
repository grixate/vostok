import { Play } from 'lucide-react'
import type { CachedMessage } from '../lib/message-cache.ts'
import type { AttachmentDescriptor, AttachmentDownloadState } from '../types.ts'
import { toAttachmentDescriptor } from '../utils/attachment-helpers.ts'
import { DownloadArrow } from './DownloadArrow.tsx'
import { DownloadProgress } from './DownloadProgress.tsx'
import { formatBytes } from '../lib/client-storage.ts'

type VideoAttachmentProps = {
  attachment: NonNullable<CachedMessage['attachment']>
  state: AttachmentDownloadState
  onDownload: (descriptor: AttachmentDescriptor) => void
  onCancel: (uploadId: string) => void
}

export function VideoAttachment({
  attachment,
  state,
  onDownload,
  onCancel,
}: VideoAttachmentProps) {
  const thumbnail = attachment.thumbnailDataUrl
  const hasKeys = !!attachment.contentKeyBase64 && !!attachment.ivBase64

  function handleTapDownload() {
    if (!hasKeys) return
    onDownload(toAttachmentDescriptor(attachment))
  }

  if (state.status === 'ready') {
    return (
      <div className="attachment-video attachment-video--ready">
        <video
          src={state.playbackUrl}
          className="attachment-video__player"
          controls
          playsInline
          preload="metadata"
        />
      </div>
    )
  }

  if (state.status === 'expired') {
    return (
      <div className="attachment-video attachment-video--expired">
        {thumbnail ? <img src={thumbnail} alt={attachment.fileName} className="attachment-video__thumb" /> : null}
        <span className="attachment-photo__expired-label">Media expired</span>
      </div>
    )
  }

  if (state.status === 'downloading' || state.status === 'decrypting' || state.status === 'auto_queued') {
    const progress = state.status === 'downloading' ? state.progress : -1
    return (
      <div className="attachment-video">
        {thumbnail ? <img src={thumbnail} alt={attachment.fileName} className="attachment-video__thumb" /> : null}
        <div className="attachment-video__overlay">
          <DownloadProgress
            progress={progress}
            downloaded={state.status === 'downloading' ? formatBytes(state.progress * attachment.size) : undefined}
            total={state.status === 'downloading' ? formatBytes(attachment.size) : undefined}
            onCancel={() => onCancel(attachment.uploadId)}
          />
        </div>
      </div>
    )
  }

  // idle / cancelled / error — show play icon with download badge
  return (
    <div className="attachment-video" onClick={handleTapDownload} style={{ cursor: 'pointer' }}>
      {thumbnail ? <img src={thumbnail} alt={attachment.fileName} className="attachment-video__thumb" /> : null}
      <div className="attachment-video__overlay">
        <div className="attachment-video__play-badge">
          <Play size={24} fill="#fff" color="#fff" />
          <span className="attachment-video__download-badge">
            <DownloadArrow size={20} fileSize={attachment.size} onTap={handleTapDownload} variant="standalone" />
          </span>
        </div>
        <span className="attachment-video__size">{formatBytes(attachment.size)}</span>
      </div>
    </div>
  )
}
