import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChatSummary } from '../lib/api.ts'
import { subscribeToTyping, pushTypingStart, pushTypingStop } from '../lib/realtime.ts'

export function useTypingIndicator(activeChat: ChatSummary | null, token?: string | null) {
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map()) // userId -> username
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Subscribe to typing events for the active chat
  useEffect(() => {
    if (!token || !activeChat?.id) {
      setTypingUsers(new Map())
      return
    }

    const chatId = activeChat.id

    const unsub = subscribeToTyping(token, chatId, {
      onTypingStart: (userId, username) => {
        setTypingUsers((prev) => {
          const next = new Map(prev)
          next.set(userId, username)
          return next
        })
        // Auto-clear after 5 seconds if no stop event
        const existing = typingTimersRef.current.get(userId)
        if (existing) clearTimeout(existing)
        typingTimersRef.current.set(
          userId,
          setTimeout(() => {
            setTypingUsers((prev) => {
              const next = new Map(prev)
              next.delete(userId)
              return next
            })
            typingTimersRef.current.delete(userId)
          }, 5000)
        )
      },
      onTypingStop: (userId) => {
        setTypingUsers((prev) => {
          const next = new Map(prev)
          next.delete(userId)
          return next
        })
        const timer = typingTimersRef.current.get(userId)
        if (timer) {
          clearTimeout(timer)
          typingTimersRef.current.delete(userId)
        }
      },
    })

    return () => {
      unsub()
      setTypingUsers(new Map())
      for (const timer of typingTimersRef.current.values()) clearTimeout(timer)
      typingTimersRef.current.clear()
    }
  }, [token, activeChat?.id])

  // Debounced typing event sender
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isTypingRef = useRef(false)

  const sendTypingEvent = useCallback(() => {
    if (!token || !activeChat?.id) return

    if (!isTypingRef.current) {
      isTypingRef.current = true
      pushTypingStart(token, activeChat.id)
    }

    // Reset the stop timer
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false
      if (token && activeChat?.id) {
        pushTypingStop(token, activeChat.id)
      }
    }, 3000)
  }, [token, activeChat?.id])

  // Clean up on unmount or chat change
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      if (isTypingRef.current && token && activeChat?.id) {
        pushTypingStop(token, activeChat.id)
      }
      isTypingRef.current = false
    }
  }, [token, activeChat?.id])

  // Format typing text
  const usernames = Array.from(typingUsers.values())
  const typingText = formatTypingText(usernames, activeChat?.type ?? 'direct')

  return {
    typingUsers: usernames,
    typingText,
    sendTypingEvent,
  }
}

function formatTypingText(typingUsers: string[], chatType: string): string | null {
  if (typingUsers.length === 0) {
    return null
  }

  if (chatType === 'group') {
    if (typingUsers.length === 1) {
      return `${typingUsers[0]} is typing...`
    }

    if (typingUsers.length === 2) {
      return `${typingUsers[0]} and ${typingUsers[1]} are typing...`
    }

    return `${typingUsers[0]} and ${typingUsers.length - 1} others are typing...`
  }

  return 'typing...'
}
