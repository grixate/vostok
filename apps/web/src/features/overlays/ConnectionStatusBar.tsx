import { useEffect, useState } from 'react'
import { useConnectionStatus } from '../../hooks/useConnectionStatus.ts'
import { t } from '../../lib/i18n.ts'

export function ConnectionStatusBar() {
  const status = useConnectionStatus()
  const [visible, setVisible] = useState(false)
  const [labelKey, setLabelKey] = useState('')

  useEffect(() => {
    if (status === 'connecting') {
      setLabelKey('connection_connecting')
      setVisible(true)
    } else if (status === 'disconnected') {
      setLabelKey('connection_waiting')
      setVisible(true)
    } else if (status === 'error') {
      setLabelKey('connection_error')
      setVisible(true)
    } else if (status === 'connected') {
      setLabelKey('connected')
      setVisible(true)
      const timer = setTimeout(() => setVisible(false), 2000)
      return () => clearTimeout(timer)
    }
  }, [status])

  if (!visible) return null

  const modifier =
    status === 'connected'
      ? 'connection-status-bar--success'
      : status === 'connecting'
        ? 'connection-status-bar--warning'
        : 'connection-status-bar--error'

  return (
    <div className={`connection-status-bar ${modifier}`}>
      {t(labelKey)}
    </div>
  )
}
