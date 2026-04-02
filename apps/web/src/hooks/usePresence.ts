import { useState, useEffect, useCallback, useRef } from 'react'
import { subscribeToPresence } from '../lib/realtime.ts'

const EMPTY_ONLINE_USER_IDS = new Set<string>()

/**
 * Subscribes to the presence channel and tracks which user IDs are currently
 * online.  Returns a stable `isUserOnline(userId)` function that components
 * can call to check presence for any user.
 */
export function usePresence(sessionToken: string | null) {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())
  const visibleOnlineUserIds = sessionToken ? onlineUserIds : EMPTY_ONLINE_USER_IDS
  const onlineRef = useRef(onlineUserIds)

  // Stabilize the token: only update when transitioning between null and
  // non-null (login/logout).  Token refreshes during bootstrap change the
  // value but the global device socket (managed by ensureDeviceSocket) should
  // not be torn down and recreated for every refresh — that kills all
  // channels on the socket, including ones set up by the server bootstrap.
  const [stableToken, setStableToken] = useState(sessionToken)
  useEffect(() => {
    // Only react to null↔non-null transitions
    if ((!stableToken) !== (!sessionToken)) {
      setStableToken(sessionToken)
    }
  }, [sessionToken, stableToken])

  useEffect(() => {
    onlineRef.current = visibleOnlineUserIds
  }, [visibleOnlineUserIds])

  useEffect(() => {
    if (!stableToken) return

    return subscribeToPresence(stableToken, {
      onSync(userIds) {
        setOnlineUserIds(userIds)
      }
    })
  }, [stableToken])

  const isUserOnline = useCallback(
    (userId: string) => onlineRef.current.has(userId),
    []
  )

  return { onlineUserIds: visibleOnlineUserIds, isUserOnline }
}
