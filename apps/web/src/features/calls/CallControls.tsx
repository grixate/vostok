import { useState, useRef, useCallback } from 'react'
import {
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  MonitorUpIcon,
  PhoneOffIcon,
} from '../../icons/index.tsx'
import { DeviceMenu } from './DeviceMenu.tsx'
import type { MediaDeviceOption } from '../../hooks/useMediaDevices.ts'
import { t } from '../../lib/i18n.ts'

type CallControlsProps = {
  muted: boolean
  cameraOn: boolean
  screenSharing: boolean
  showCamera?: boolean
  showScreen?: boolean
  audioDevices?: MediaDeviceOption[]
  videoDevices?: MediaDeviceOption[]
  onToggleMute: () => void
  onToggleCamera?: () => void
  onToggleScreen?: () => void
  onSwitchDevice?: (deviceId: string, kind: 'audio' | 'video') => void
  onHangup: () => void
}

export function CallControls({
  muted,
  cameraOn,
  screenSharing,
  showCamera = true,
  showScreen = true,
  audioDevices = [],
  videoDevices = [],
  onToggleMute,
  onToggleCamera,
  onToggleScreen,
  onSwitchDevice,
  onHangup,
}: CallControlsProps) {
  const [deviceMenu, setDeviceMenu] = useState<'audio' | 'video' | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openDeviceMenu = useCallback((kind: 'audio' | 'video') => {
    setDeviceMenu((prev) => prev === kind ? null : kind)
  }, [])

  const makeLongPressHandlers = useCallback((kind: 'audio' | 'video', hasDevices: boolean) => {
    if (!hasDevices || !onSwitchDevice) return {}
    return {
      onTouchStart: () => {
        longPressTimer.current = setTimeout(() => { openDeviceMenu(kind) }, 500)
      },
      onTouchEnd: () => {
        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
      },
      onTouchMove: () => {
        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
      },
    }
  }, [onSwitchDevice, openDeviceMenu])

  return (
    <div className="call-controls">
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className={`call-controls__btn${muted ? ' call-controls__btn--active' : ''}`}
          onClick={onToggleMute}
          onContextMenu={(e) => {
            if (audioDevices.length > 1 && onSwitchDevice) {
              e.preventDefault()
              openDeviceMenu('audio')
            }
          }}
          {...makeLongPressHandlers('audio', audioDevices.length > 1)}
          aria-label={muted ? t('unmute_microphone') : t('mute_microphone')}
          aria-pressed={muted}
        >
          {muted ? <MicOffIcon width={22} height={22} /> : <MicIcon width={22} height={22} />}
        </button>
        {deviceMenu === 'audio' && onSwitchDevice && (
          <DeviceMenu
            devices={audioDevices}
            label={t('microphone')}
            onSelect={(id) => onSwitchDevice(id, 'audio')}
            onClose={() => setDeviceMenu(null)}
          />
        )}
      </div>

      {showCamera && (
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className={`call-controls__btn${!cameraOn ? ' call-controls__btn--active' : ''}`}
            onClick={onToggleCamera}
            onContextMenu={(e) => {
              if (videoDevices.length > 1 && onSwitchDevice) {
                e.preventDefault()
                openDeviceMenu('video')
              }
            }}
            {...makeLongPressHandlers('video', videoDevices.length > 1)}
            aria-label={cameraOn ? t('turn_off_camera') : t('turn_on_camera')}
            aria-pressed={!cameraOn}
          >
            {cameraOn ? <VideoIcon width={22} height={22} /> : <VideoOffIcon width={22} height={22} />}
          </button>
          {deviceMenu === 'video' && onSwitchDevice && (
            <DeviceMenu
              devices={videoDevices}
              label={t('camera')}
              onSelect={(id) => onSwitchDevice(id, 'video')}
              onClose={() => setDeviceMenu(null)}
            />
          )}
        </div>
      )}

      {showScreen && (
        <button
          type="button"
          className={`call-controls__btn${screenSharing ? ' call-controls__btn--active' : ''}`}
          onClick={onToggleScreen}
          aria-label={screenSharing ? t('stop_screen_sharing') : t('share_screen')}
          aria-pressed={screenSharing}
        >
          <MonitorUpIcon width={22} height={22} />
        </button>
      )}

      <button
        type="button"
        className="call-controls__btn call-controls__btn--hangup"
        onClick={onHangup}
        aria-label={t('end_call')}
      >
        <PhoneOffIcon width={22} height={22} />
      </button>
    </div>
  )
}
