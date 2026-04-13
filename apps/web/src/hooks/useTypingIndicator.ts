import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChatSummary } from '../lib/api.ts'
import { getRawChatId } from '../lib/multi-server.ts'
import { subscribeToTyping, pushTypingStart, pushTypingStop } from '../lib/realtime.ts'

export function useTypingIndicator(activeChat: ChatSummary | null, token?: string | null) {
  const activeChatId = activeChat?.id ?? null
  const activeRawChatId = getRawChatId(activeChatId)
  const [typingState, setTypingState] = useState<{ chatId: string | null; users: Map<string, string> }>({
    chatId: null,
    users: new Map()
  })
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Subscribe to typing events for the active chat
  useEffect(() => {
    if (!token || !activeChatId || !activeRawChatId) {
      return
    }

    const chatId = activeChatId
    const rawChatId = activeRawChatId
    const typingTimers = typingTimersRef.current

    const unsub = subscribeToTyping(token, rawChatId, {
      onTypingStart: (userId, username) => {
        setTypingState((prev) => {
          const next = new Map(prev.chatId === chatId ? prev.users : new Map())
          next.set(userId, username)
          return { chatId, users: next }
        })
        // Auto-clear after 2.5 seconds if no stop event
        const existing = typingTimers.get(userId)
        if (existing) clearTimeout(existing)
        typingTimers.set(
          userId,
          setTimeout(() => {
            setTypingState((prev) => {
              if (prev.chatId !== chatId) {
                return prev
              }

              const next = new Map(prev.users)
              next.delete(userId)
              return { chatId, users: next }
            })
            typingTimers.delete(userId)
          }, 2500)
        )
      },
      onTypingStop: (userId) => {
        setTypingState((prev) => {
          if (prev.chatId !== chatId) {
            return prev
          }

          const next = new Map(prev.users)
          next.delete(userId)
          return { chatId, users: next }
        })
        const timer = typingTimers.get(userId)
        if (timer) {
          clearTimeout(timer)
          typingTimers.delete(userId)
        }
      },
    })

    return () => {
      unsub()
      for (const timer of typingTimers.values()) clearTimeout(timer)
      typingTimers.clear()
    }
  }, [activeChatId, activeRawChatId, token])

  // Debounced typing event sender
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isTypingRef = useRef(false)

  const sendTypingEvent = useCallback(() => {
    if (!token || !activeChatId || !activeRawChatId) return

    if (!isTypingRef.current) {
      isTypingRef.current = true
      pushTypingStart(token, activeRawChatId)
    }

    // Reset the stop timer — send stop after 1.5s of inactivity
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false
      if (token && activeRawChatId) {
        pushTypingStop(token, activeRawChatId)
      }
    }, 1500)
  }, [activeChatId, activeRawChatId, token])

  // Immediately stop typing (call on message send)
  const stopTypingNow = useCallback(() => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current)
      typingTimerRef.current = null
    }
    if (isTypingRef.current && token && activeRawChatId) {
      isTypingRef.current = false
      pushTypingStop(token, activeRawChatId)
    }
  }, [activeRawChatId, token])

  // Clean up on unmount or chat change
  useEffect(() => {
    return () => {
      const timer = typingTimerRef.current
      if (timer) clearTimeout(timer)
      if (isTypingRef.current && token && activeRawChatId) {
        pushTypingStop(token, activeRawChatId)
      }
      isTypingRef.current = false
    }
  }, [activeChatId, activeRawChatId, token])

  // Format typing text
  const usernames = Array.from(typingState.chatId === activeChatId ? typingState.users.values() : [])
  const typingText = formatTypingText(usernames, activeChat?.type ?? 'direct')

  return {
    typingUsers: usernames,
    typingText,
    sendTypingEvent,
    stopTypingNow,
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
