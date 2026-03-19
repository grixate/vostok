import { useEffect, useState } from 'react'
import { useConnectionStatus } from '../../hooks/useConnectionStatus.ts'

export function ConnectionStatusBar() {
  const status = useConnectionStatus()
  const [visible, setVisible] = useState(false)
  const [label, setLabel] = useState('')

  useEffect(() => {
    if (status === 'connecting') {
      setLabel('Connecting...')
      setVisible(true)
    } else if (status === 'disconnected') {
      setLabel('Waiting for network...')
      setVisible(true)
    } else if (status === 'error') {
      setLabel('Connection error')
      setVisible(true)
    } else if (status === 'connected') {
      setLabel('Connected')
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
      {label}
    </div>
  )
}
