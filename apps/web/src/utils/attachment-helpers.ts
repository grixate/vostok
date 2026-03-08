import type { CachedMessage } from '../lib/message-cache.ts'
import type { AttachmentDescriptor } from '../types.ts'

export function toAttachmentDescriptor(attachment: NonNullable<CachedMessage['attachment']>): AttachmentDescriptor {
  if (!attachment.contentKeyBase64 || !attachment.ivBase64) {
    throw new Error('The attachment is missing local decryption material.')
  }

  return {
    kind: 'attachment',
    uploadId: attachment.uploadId,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    size: attachment.size,
    thumbnailDataUrl: attachment.thumbnailDataUrl,
    waveform: attachment.waveform,
    contentKeyBase64: attachment.contentKeyBase64,
    ivBase64: attachment.ivBase64
  }
}

export function isVoiceNoteAttachment(
  attachment: Pick<NonNullable<CachedMessage['attachment']>, 'fileName' | 'contentType'>
): boolean {
  return attachment.contentType.startsWith('audio/') && attachment.fileName.startsWith('voice-note-')
}

export function isRoundVideoAttachment(
  attachment: Pick<NonNullable<CachedMessage['attachment']>, 'fileName' | 'contentType'>
): boolean {
  return attachment.contentType.startsWith('video/') && attachment.fileName.startsWith('round-video-')
}

export function inferMediaKind(contentType: string): 'file' | 'image' | 'audio' | 'video' {
  if (contentType.startsWith('image/')) {
    return 'image'
  }

  if (contentType.startsWith('audio/')) {
    return 'audio'
  }

  if (contentType.startsWith('video/')) {
    return 'video'
  }

  return 'file'
}
