import { useRef, useEffect } from 'react'
import { t } from '../../lib/i18n.ts'

type ScreenShareViewProps = {
  stream: MediaStream
  presenterName: string
  isSelf: boolean
  onStopSharing?: () => void
}

export function ScreenShareView({ stream, presenterName, isSelf, onStopSharing }: ScreenShareViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (el) el.srcObject = stream
    return () => { if (el) el.srcObject = null }
  }, [stream])

  return (
    <div className="screen-share-view">
      <video
        ref={videoRef}
        className="screen-share-view__video"
        autoPlay
        playsInline
      />
      <span className="screen-share-view__label">
        {isSelf ? t('sharing_screen') : t('presenting', presenterName)}
      </span>
      {isSelf && onStopSharing && (
        <button type="button" className="screen-share-view__stop" onClick={onStopSharing}>
          {t('stop_sharing')}
        </button>
      )}
    </div>
  )
}
