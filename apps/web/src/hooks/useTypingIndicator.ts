import { useState, useCallback } from 'react'
import type { ChatSummary } from '../lib/api.ts'

export function useTypingIndicator(activeChat: ChatSummary | null) {
  // For now, typing indicators are purely visual / mock.
  // No real WebSocket events are sent or received.
  const [typingUsers] = useState<string[]>([])

  // No-op: will connect to server later
  const sendTypingEvent = useCallback(() => {
    // Placeholder for future WebSocket typing event
  }, [])

  // Format typing text based on chat type
  const typingText = formatTypingText(typingUsers, activeChat?.type ?? 'direct')

  return {
    typingUsers,
    typingText,
    sendTypingEvent
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
