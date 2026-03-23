import { useRef, useEffect } from 'react'

type SelfPreviewPiPProps = {
  stream: MediaStream
}

export function SelfPreviewPiP({ stream }: SelfPreviewPiPProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (el) el.srcObject = stream
    return () => { if (el) el.srcObject = null }
  }, [stream])

  return (
    <div className="self-preview-pip">
      <video
        ref={videoRef}
        className="self-preview-pip__video"
        autoPlay
        playsInline
        muted
      />
    </div>
  )
}
