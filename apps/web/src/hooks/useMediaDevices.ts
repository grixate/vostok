import { useCallback, useEffect, useState } from 'react'

export type MediaDeviceOption = {
  deviceId: string
  label: string
  kind: 'audioinput' | 'videoinput' | 'audiooutput'
}

export function useMediaDevices(active: boolean) {
  const [audioInputs, setAudioInputs] = useState<MediaDeviceOption[]>([])
  const [videoInputs, setVideoInputs] = useState<MediaDeviceOption[]>([])

  const enumerate = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setAudioInputs(
        devices
          .filter((d) => d.kind === 'audioinput' && d.deviceId)
          .map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId.slice(0, 4)}`, kind: d.kind }))
      )
      setVideoInputs(
        devices
          .filter((d) => d.kind === 'videoinput' && d.deviceId)
          .map((d) => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 4)}`, kind: d.kind }))
      )
    } catch {
      // Permission denied or not available
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void enumerate()
    navigator.mediaDevices.addEventListener('devicechange', enumerate)
    return () => { navigator.mediaDevices.removeEventListener('devicechange', enumerate) }
  }, [active, enumerate])

  return { audioInputs, videoInputs, enumerate }
}
