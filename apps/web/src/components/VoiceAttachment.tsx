import { ArrowDown } from 'lucide-react'
import type { CachedMessage } from '../lib/message-cache.ts'
import type { AttachmentDescriptor, AttachmentDownloadState } from '../types.ts'
import { toAttachmentDescriptor } from '../utils/attachment-helpers.ts'
import { formatBytes } from '../lib/client-storage.ts'
import { VoiceMessageBubble } from '../features/conversation/VoiceMessageBubble.tsx'

type VoiceAttachmentProps = {
  attachment: NonNullable<CachedMessage['attachment']>
  state: AttachmentDownloadState
  side: 'incoming' | 'outgoing'
  onDownload: (descriptor: AttachmentDescriptor) => void
}

function StaticWaveform({ waveform }: { waveform?: number[] }) {
  const bars = waveform ?? Array.from({ length: 24 }, (_, i) => 0.3 + Math.sin(i * 0.7) * 0.3)
  return (
    <div className="voice-attachment__bars">
      {bars.map((v, i) => (
        <div key={i} className="voice-attachment__bar" style={{ height: `${Math.max(4, v * 28)}px` }} />
      ))}
    </div>
  )
}

export function VoiceAttachment({
  attachment,
  state,
  side,
  onDownload,
}: VoiceAttachmentProps) {
  const hasKeys = !!attachment.contentKeyBase64 && !!attachment.ivBase64

  // Ready — use existing voice bubble
  if (state.status === 'ready') {
    const descriptor = hasKeys ? toAttachmentDescriptor(attachment) : null
    if (descriptor) {
      return (
        <VoiceMessageBubble
          descriptor={descriptor}
          playbackUrl={state.playbackUrl}
          side={side}
        />
      )
    }
  }

  // Downloading / auto_queued / decrypting — pulsing play button with static waveform
  if (state.status === 'downloading' || state.status === 'decrypting' || state.status === 'auto_queued') {
    return (
      <div className="voice-attachment voice-attachment--loading">
        <div className="voice-attachment__play voice-attachment__play--pulse" />
        <StaticWaveform waveform={attachment.waveform} />
      </div>
    )
  }

  // idle / cancelled / error — download arrow replacing play button
  return (
    <div
      className="voice-attachment"
      onClick={() => { if (hasKeys) onDownload(toAttachmentDescriptor(attachment)) }}
      style={{ cursor: hasKeys ? 'pointer' : 'default' }}
    >
      <div className="voice-attachment__download-btn">
        <ArrowDown size={16} strokeWidth={2.5} />
      </div>
      <StaticWaveform waveform={attachment.waveform} />
      <span className="voice-attachment__size">{formatBytes(attachment.size)}</span>
    </div>
  )
}
