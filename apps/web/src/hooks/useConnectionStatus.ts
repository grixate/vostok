import { useState, useEffect } from 'react'
import { subscribeToConnectionStatus, type ConnectionStatus } from '../lib/realtime.ts'

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  useEffect(() => {
    return subscribeToConnectionStatus(setStatus)
  }, [])

  return status
}
