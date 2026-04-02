import { FileText, ArrowDown, Check, AlertCircle } from 'lucide-react'
import type { CachedMessage } from '../lib/message-cache.ts'
import type { AttachmentDescriptor, AttachmentDownloadState } from '../types.ts'
import { toAttachmentDescriptor } from '../utils/attachment-helpers.ts'
import { DownloadProgress } from './DownloadProgress.tsx'
import { formatBytes } from '../lib/client-storage.ts'

type FileAttachmentProps = {
  attachment: NonNullable<CachedMessage['attachment']>
  state: AttachmentDownloadState
  onDownload: (descriptor: AttachmentDescriptor) => void
  onCancel: (uploadId: string) => void
  onSave: (descriptor: AttachmentDescriptor) => void
}

function getFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toUpperCase() : 'FILE'
}

export function FileAttachment({
  attachment,
  state,
  onDownload,
  onCancel,
  onSave,
}: FileAttachmentProps) {
  const hasKeys = !!attachment.contentKeyBase64 && !!attachment.ivBase64
  const ext = getFileExtension(attachment.fileName)

  function handleTap() {
    if (!hasKeys) return
    if (state.status === 'ready') {
      onSave(toAttachmentDescriptor(attachment))
    } else if (state.status === 'idle' || state.status === 'cancelled' || (state.status === 'error' && state.retryable)) {
      onDownload(toAttachmentDescriptor(attachment))
    }
  }

  return (
    <div className="attachment-file" onClick={handleTap} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') handleTap() }}>
      <div className="attachment-file__icon">
        {state.status === 'downloading' || state.status === 'decrypting' || state.status === 'auto_queued' ? (
          <DownloadProgress
            size={40}
            progress={state.status === 'downloading' ? state.progress : -1}
            onCancel={() => onCancel(attachment.uploadId)}
          />
        ) : (
          <>
            <FileText size={24} strokeWidth={1.5} />
            <span className="attachment-file__ext">{ext}</span>
            {state.status === 'ready' ? (
              <Check size={12} className="attachment-file__badge attachment-file__badge--done" />
            ) : state.status === 'error' ? (
              <AlertCircle size={12} className="attachment-file__badge attachment-file__badge--error" />
            ) : state.status === 'expired' ? null : (
              <ArrowDown size={12} className="attachment-file__badge attachment-file__badge--download" />
            )}
          </>
        )}
      </div>
      <div className="attachment-file__info">
        <span className="attachment-file__name">{attachment.fileName}</span>
        <span className="attachment-file__meta">
          {state.status === 'expired'
            ? 'File expired'
            : state.status === 'ready'
              ? 'Downloaded'
              : state.status === 'error'
                ? state.message
                : formatBytes(attachment.size)}
        </span>
      </div>
    </div>
  )
}
