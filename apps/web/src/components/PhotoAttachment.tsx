import type { CachedMessage } from '../lib/message-cache.ts'
import type { AttachmentDescriptor, AttachmentDownloadState } from '../types.ts'
import { toAttachmentDescriptor } from '../utils/attachment-helpers.ts'
import { DownloadArrow } from './DownloadArrow.tsx'
import { DownloadProgress } from './DownloadProgress.tsx'
import { formatBytes } from '../lib/client-storage.ts'

type PhotoAttachmentProps = {
  attachment: NonNullable<CachedMessage['attachment']>
  state: AttachmentDownloadState
  onDownload: (descriptor: AttachmentDescriptor) => void
  onCancel: (uploadId: string) => void
  onOpenMedia?: (
    thumbnailUrl: string,
    type: 'image' | 'video',
    senderName: string,
    timestamp: string,
    fileName: string,
  ) => void
  senderName: string
  timestamp: string
}

export function PhotoAttachment({
  attachment,
  state,
  onDownload,
  onCancel,
  onOpenMedia,
  senderName,
  timestamp,
}: PhotoAttachmentProps) {
  const thumbnail = attachment.thumbnailDataUrl
  const hasKeys = !!attachment.contentKeyBase64 && !!attachment.ivBase64

  function handleTapDownload() {
    if (!hasKeys) return
    onDownload(toAttachmentDescriptor(attachment))
  }

  if (state.status === 'ready') {
    return (
      <img
        alt={attachment.fileName}
        className="attachment-photo attachment-photo--ready"
        src={state.playbackUrl}
        onClick={(e) => {
          e.stopPropagation()
          onOpenMedia?.(state.playbackUrl, 'image', senderName, timestamp, attachment.fileName)
        }}
        style={{ cursor: 'pointer' }}
      />
    )
  }

  if (state.status === 'expired') {
    return (
      <div className="attachment-photo attachment-photo--expired">
        {thumbnail ? <img src={thumbnail} alt={attachment.fileName} className="attachment-photo__thumb" /> : null}
        <span className="attachment-photo__expired-label">Media expired</span>
      </div>
    )
  }

  if (state.status === 'downloading' || state.status === 'decrypting' || state.status === 'auto_queued') {
    const progress = state.status === 'downloading' ? state.progress : -1
    return (
      <div className="attachment-photo">
        {thumbnail ? <img src={thumbnail} alt={attachment.fileName} className="attachment-photo__thumb" /> : null}
        <div className="attachment-photo__overlay">
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

  if (state.status === 'error') {
    return (
      <div className="attachment-photo" onClick={state.retryable ? handleTapDownload : undefined} style={{ cursor: state.retryable ? 'pointer' : 'default' }}>
        {thumbnail ? <img src={thumbnail} alt={attachment.fileName} className="attachment-photo__thumb" /> : null}
        <div className="attachment-photo__overlay">
          <span className="attachment-photo__error">{state.retryable ? 'Tap to retry' : state.message}</span>
        </div>
      </div>
    )
  }

  // idle / cancelled — show download arrow
  return (
    <div className="attachment-photo">
      {thumbnail ? <img src={thumbnail} alt={attachment.fileName} className="attachment-photo__thumb" /> : null}
      <div className="attachment-photo__overlay">
        <DownloadArrow fileSize={attachment.size} onTap={handleTapDownload} />
      </div>
    </div>
  )
}
