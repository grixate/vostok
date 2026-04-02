import { ArrowDown } from 'lucide-react'
import type { CachedMessage } from '../lib/message-cache.ts'
import type { AttachmentDescriptor, AttachmentDownloadState } from '../types.ts'
import { toAttachmentDescriptor } from '../utils/attachment-helpers.ts'
import { DownloadProgress } from './DownloadProgress.tsx'
import { formatBytes } from '../lib/client-storage.ts'
import { RoundVideoBubble } from '../features/conversation/RoundVideoBubble.tsx'

type RoundVideoAttachmentProps = {
  attachment: NonNullable<CachedMessage['attachment']>
  state: AttachmentDownloadState
  side: 'incoming' | 'outgoing'
  timestamp: string
  onDownload: (descriptor: AttachmentDescriptor) => void
  onCancel: (uploadId: string) => void
}

export function RoundVideoAttachment({
  attachment,
  state,
  side,
  timestamp,
  onDownload,
  onCancel,
}: RoundVideoAttachmentProps) {
  const thumbnail = attachment.thumbnailDataUrl
  const hasKeys = !!attachment.contentKeyBase64 && !!attachment.ivBase64

  // Ready — use existing round video bubble
  if (state.status === 'ready' && hasKeys) {
    return (
      <RoundVideoBubble
        descriptor={toAttachmentDescriptor(attachment)}
        playbackUrl={state.playbackUrl}
        side={side}
        timestamp={timestamp}
      />
    )
  }

  // Downloading / decrypting / auto_queued — progress ring in circle
  if (state.status === 'downloading' || state.status === 'decrypting' || state.status === 'auto_queued') {
    const progress = state.status === 'downloading' ? state.progress : -1
    return (
      <div className={`round-video round-video--${side}`}>
        <div className="round-video__wrapper" style={{ width: 180, height: 180 }}>
          {thumbnail ? (
            <img
              alt="Video message"
              className="round-video__video"
              src={thumbnail}
              style={{ width: 174, height: 174, top: 3, left: 3, position: 'absolute', borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : null}
          <div className="round-video__play-overlay">
            <DownloadProgress
              progress={progress}
              size={48}
              onCancel={() => onCancel(attachment.uploadId)}
            />
          </div>
        </div>
        <div className="round-video__caption">
          <span className="round-video__time">{timestamp}</span>
        </div>
      </div>
    )
  }

  // idle / cancelled / error / expired — download arrow in circle
  return (
    <div className={`round-video round-video--${side}`}>
      <div className="round-video__wrapper" style={{ width: 180, height: 180 }}>
        {thumbnail ? (
          <img
            alt="Video message"
            className="round-video__video"
            src={thumbnail}
            style={{ width: 174, height: 174, top: 3, left: 3, position: 'absolute', borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : null}
        <div
          className="round-video__play-overlay"
          onClick={() => { if (hasKeys && state.status !== 'expired') onDownload(toAttachmentDescriptor(attachment)) }}
          style={{ cursor: state.status === 'expired' ? 'default' : 'pointer' }}
        >
          {state.status === 'expired' ? (
            <span style={{ color: '#aaa', fontSize: 12 }}>Expired</span>
          ) : (
            <ArrowDown size={24} strokeWidth={2.5} color="#fff" />
          )}
        </div>
      </div>
      <div className="round-video__caption">
        <span className="round-video__time">{timestamp}</span>
        {state.status !== 'expired' && (
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>{formatBytes(attachment.size)}</span>
        )}
      </div>
    </div>
  )
}
