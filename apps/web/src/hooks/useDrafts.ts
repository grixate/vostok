import { useState, useEffect, useRef, useCallback } from 'react'
import { readDraft, writeDraft, clearDraft, listDraftChatIds } from '../lib/draft-store.ts'

export function useDrafts(
  activeChatId: string | null,
  draft: string,
  setDraft: (value: string) => void,
  replyTargetMessageId: string | null
) {
  const [draftChatIds, setDraftChatIds] = useState<Set<string>>(new Set())
  const previousChatIdRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedTextRef = useRef<string>('')

  // On mount: load all draft chat IDs
  useEffect(() => {
    void listDraftChatIds().then((ids) => {
      setDraftChatIds(new Set(ids))
    }).catch(() => {
      // Ignore errors on mount
    })
  }, [])

  // Save draft for previous chat and load draft for new chat when active chat changes
  useEffect(() => {
    const previousChatId = previousChatIdRef.current

    // Save draft for the previous chat
    if (previousChatId && lastSavedTextRef.current.trim()) {
      void writeDraft({
        chatId: previousChatId,
        text: lastSavedTextRef.current,
        replyToMessageId: replyTargetMessageId
      }).then(() => {
        setDraftChatIds((prev) => {
          const next = new Set(prev)
          next.add(previousChatId)
          return next
        })
      }).catch(() => {
        // Ignore save errors
      })
    } else if (previousChatId) {
      void clearDraft(previousChatId).then(() => {
        setDraftChatIds((prev) => {
          const next = new Set(prev)
          next.delete(previousChatId)
          return next
        })
      }).catch(() => {
        // Ignore clear errors
      })
    }

    previousChatIdRef.current = activeChatId
    lastSavedTextRef.current = ''

    // Load draft for the new active chat
    if (activeChatId) {
      void readDraft(activeChatId).then((stored) => {
        if (stored && stored.text.trim()) {
          setDraft(stored.text)
          lastSavedTextRef.current = stored.text
        }
      }).catch(() => {
        // Ignore load errors
      })
    }
  }, [activeChatId])

  // Debounced auto-save on draft text change
  const handleDraftChange = useCallback((text: string) => {
    lastSavedTextRef.current = text

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(() => {
      if (!activeChatId) return

      if (text.trim()) {
        void writeDraft({
          chatId: activeChatId,
          text,
          replyToMessageId: replyTargetMessageId
        }).then(() => {
          setDraftChatIds((prev) => {
            const next = new Set(prev)
            next.add(activeChatId)
            return next
          })
        }).catch(() => {
          // Ignore save errors
        })
      } else {
        void clearDraft(activeChatId).then(() => {
          setDraftChatIds((prev) => {
            const next = new Set(prev)
            next.delete(activeChatId)
            return next
          })
        }).catch(() => {
          // Ignore clear errors
        })
      }
    }, 500)
  }, [activeChatId, replyTargetMessageId])

  // On message send: clear the draft for that chat
  const handleMessageSent = useCallback(() => {
    if (!activeChatId) return

    lastSavedTextRef.current = ''

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    void clearDraft(activeChatId).then(() => {
      setDraftChatIds((prev) => {
        const next = new Set(prev)
        next.delete(activeChatId)
        return next
      })
    }).catch(() => {
      // Ignore clear errors
    })
  }, [activeChatId])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  return {
    draftChatIds,
    handleDraftChange,
    handleMessageSent
  }
}
