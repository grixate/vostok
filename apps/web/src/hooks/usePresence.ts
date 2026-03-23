import { useState, useEffect, useCallback, useRef } from 'react'
import { subscribeToPresence } from '../lib/realtime.ts'

/**
 * Subscribes to the presence channel and tracks which user IDs are currently
 * online.  Returns a stable `isUserOnline(userId)` function that components
 * can call to check presence for any user.
 */
export function usePresence(sessionToken: string | null) {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())
  const onlineRef = useRef(onlineUserIds)
  onlineRef.current = onlineUserIds

  useEffect(() => {
    if (!sessionToken) {
      setOnlineUserIds(new Set())
      return
    }

    return subscribeToPresence(sessionToken, {
      onSync(userIds) {
        setOnlineUserIds(userIds)
      }
    })
  }, [sessionToken])

  const isUserOnline = useCallback(
    (userId: string) => onlineRef.current.has(userId),
    []
  )

  return { onlineUserIds, isUserOnline }
}
