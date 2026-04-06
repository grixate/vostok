import { useRef, useEffect } from 'react'

type SelfPreviewPiPProps = {
  stream: MediaStream
}

export function SelfPreviewPiP({ stream }: SelfPreviewPiPProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackSignature = stream
    .getTracks()
    .map((track) => `${track.kind}:${track.id}:${track.enabled ? 'on' : 'off'}`)
    .join('|')

  useEffect(() => {
    const el = videoRef.current
    if (el) {
      el.srcObject = stream
      void el.play().catch(() => undefined)
    }
    return () => { if (el) el.srcObject = null }
  }, [stream, trackSignature])

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
