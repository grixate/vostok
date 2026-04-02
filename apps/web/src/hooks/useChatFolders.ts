import { useState, useCallback } from 'react'
import type { ChatSummary } from '../lib/api.ts'

export type ChatFolder = {
  id: string
  name: string
  chatIds: string[] // empty = show all
}

const DEFAULT_FOLDERS: ChatFolder[] = [
  { id: 'all', name: 'All', chatIds: [] },
  { id: 'personal', name: 'Personal', chatIds: [] },
  { id: 'groups', name: 'Groups', chatIds: [] },
]

const STORAGE_KEY = 'vostok.chat-folders.active'

function readStoredActiveFolderId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'all'
  } catch {
    return 'all'
  }
}

export function useChatFolders() {
  const [folders] = useState<ChatFolder[]>(DEFAULT_FOLDERS)
  const [activeFolderId, setActiveFolderIdRaw] = useState<string>(() => readStoredActiveFolderId())

  const setActiveFolderId = useCallback((id: string) => {
    setActiveFolderIdRaw(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // localStorage may be unavailable
    }
  }, [])

  const filterChatsByFolder = useCallback(
    <T extends ChatSummary>(chatItems: T[]): T[] => {
      if (activeFolderId === 'all') {
        return chatItems
      }

      if (activeFolderId === 'personal') {
        return chatItems.filter((chat) => chat.type !== 'group')
      }

      if (activeFolderId === 'groups') {
        return chatItems.filter((chat) => chat.type === 'group')
      }

      // Custom folder: filter by explicit chatIds
      const folder = folders.find((f) => f.id === activeFolderId)

      if (!folder || folder.chatIds.length === 0) {
        return chatItems
      }

      const idSet = new Set(folder.chatIds)
      return chatItems.filter((chat) => idSet.has(chat.id))
    },
    [activeFolderId, folders]
  )

  const getUnreadCountForFolder = useCallback(
    <T extends ChatSummary>(folderId: string, chatItems: T[]): number => {
      let filtered: T[]

      if (folderId === 'all') {
        filtered = chatItems
      } else if (folderId === 'personal') {
        filtered = chatItems.filter((chat) => chat.type !== 'group')
      } else if (folderId === 'groups') {
        filtered = chatItems.filter((chat) => chat.type === 'group')
      } else {
        const folder = folders.find((f) => f.id === folderId)
        if (!folder || folder.chatIds.length === 0) {
          filtered = chatItems
        } else {
          const idSet = new Set(folder.chatIds)
          filtered = chatItems.filter((chat) => idSet.has(chat.id))
        }
      }

      return filtered.filter((chat) => chat.message_count > 0).length
    },
    [folders]
  )

  return {
    folders,
    activeFolderId,
    setActiveFolderId,
    filterChatsByFolder,
    getUnreadCountForFolder
  }
}
