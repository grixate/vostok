import { useCallback, useEffect } from 'react'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { t } from '../../lib/i18n.ts'
import { PhoneIcon, PhoneOffIcon, VideoIcon } from '../../icons/index.tsx'
import { playRingtone, stopRingtone } from '../calls/callSounds.ts'
import type { useCall } from '../../hooks/useCall.ts'

type IncomingCallOverlayProps = {
  call: ReturnType<typeof useCall>
  onAccepted?: () => void
}

export function IncomingCallOverlay({ call, onAccepted }: IncomingCallOverlayProps) {
  const { storedDevice } = useAppContext()
  const localDeviceId = storedDevice?.deviceId ?? null
  const activeCall = call.activeCall

  const isIncoming =
    activeCall != null &&
    activeCall.status === 'ringing' &&
    activeCall.started_by_device_id !== localDeviceId

  // Play ringtone while incoming
  useEffect(() => {
    if (!isIncoming) return
    playRingtone()
    return () => { stopRingtone() }
  }, [isIncoming])

  const handleAccept = useCallback(async () => {
    await call.handleAcceptCall()
    onAccepted?.()
  }, [call, onAccepted])

  if (!isIncoming || !activeCall) return null

  const callerName = call.activeCallDisplayTitle ?? t('unknown_caller')
  const initial = callerName.slice(0, 1).toUpperCase()
  const isVideo = activeCall.mode === 'video' || activeCall.media_mode === 'video'

  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-overlay__card">
        <div className="incoming-call-overlay__avatar">{initial}</div>
        <span className="incoming-call-overlay__name">{callerName}</span>
        <span className="incoming-call-overlay__subtitle">
          {isVideo ? t('call_incoming_video') : t('call_incoming_voice')}{isVideo ? <VideoIcon width={14} height={14} /> : null}
        </span>
        <div className="incoming-call-overlay__actions">
          <button
            type="button"
            className="incoming-call-overlay__action-btn incoming-call-overlay__action-btn--decline"
            onClick={call.handleDeclineCall}
            aria-label={t('decline_call')}
          >
            <PhoneOffIcon width={24} height={24} />
          </button>
          <button
            type="button"
            className="incoming-call-overlay__action-btn incoming-call-overlay__action-btn--accept"
            onClick={handleAccept}
            aria-label={t('accept_call')}
          >
            <PhoneIcon width={24} height={24} />
          </button>
        </div>
      </div>
    </div>
  )
}
