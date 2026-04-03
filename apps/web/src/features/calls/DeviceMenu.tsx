import { useEffect, useRef } from 'react'
import type { MediaDeviceOption } from '../../hooks/useMediaDevices.ts'

type DeviceMenuProps = {
  devices: MediaDeviceOption[]
  label: string
  onSelect: (deviceId: string) => void
  onClose: () => void
}

export function DeviceMenu({ devices, label, onSelect, onClose }: DeviceMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  if (devices.length === 0) return null

  return (
    <div className="device-menu" ref={ref}>
      <div className="device-menu__label">{label}</div>
      {devices.map((device) => (
        <button
          key={device.deviceId}
          type="button"
          className="device-menu__item"
          onClick={() => { onSelect(device.deviceId); onClose() }}
        >
          {device.label}
        </button>
      ))}
    </div>
  )
}
