import { useEffect, useState } from 'react'
import type { AttachmentDescriptor } from '../types'

export function RoundVideoPlayer({
  attachment,
  onResolveMediaUrl
}: {
  attachment: AttachmentDescriptor
  onResolveMediaUrl: (attachment: AttachmentDescriptor) => Promise<string>
}) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMediaUrl(null)
    setError(null)
  }, [attachment.uploadId])

  async function handleLoad() {
    setLoading(true)
    setError(null)

    try {
      const resolved = await onResolveMediaUrl(attachment)
      setMediaUrl(resolved)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load round video.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="round-video-player">
      {!mediaUrl ? (
        <button className="secondary-action" disabled={loading} onClick={() => void handleLoad()} type="button">
          {loading ? 'Loading round video…' : 'Play Round Video'}
        </button>
      ) : (
        <video className="round-video-player__video" controls playsInline preload="metadata" src={mediaUrl} />
      )}
      {error ? <span className="settings-card__muted">{error}</span> : null}
    </div>
  )
}
