export type CachedAttachment = {
  uploadId: string
  fileName: string
  contentType: string
  size: number
  thumbnailDataUrl?: string
  waveform?: number[]
  contentKeyBase64?: string
  ivBase64?: string
}

export type CachedMessage = {
  id: string
  clientId?: string
  replyToMessageId?: string
  text: string
  sentAt: string
  pinnedAt?: string
  editedAt?: string
  deletedAt?: string
  side: 'incoming' | 'outgoing' | 'system'
  senderId?: string
  senderUsername?: string
  decryptable: boolean
  attachment?: CachedAttachment
  reactions?: Array<{
    reactionKey: string
    count: number
    reacted: boolean
  }>
}

const CACHE_PREFIX = 'vostok.chat-cache.'
const DB_NAME = 'vostok-offline'
const STORE_NAME = 'messages'
const DB_VERSION = 1

export async function readCachedMessages(chatId: string): Promise<CachedMessage[]> {
  const database = await openMessageCacheDatabase()

  if (!database) {
    return readLegacyCachedMessages(chatId)
  }

  const persisted = await new Promise<CachedMessage[] | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(chatId)

    request.onsuccess = () => {
      const result = request.result as { chatId: string; messages: CachedMessage[] } | undefined
      resolve(Array.isArray(result?.messages) ? result.messages : null)
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to read cached messages.'))
  })

  if (persisted) {
    return persisted
  }

  const legacy = readLegacyCachedMessages(chatId)

  if (legacy.length > 0) {
    await writeCachedMessages(chatId, legacy)
  }

  return legacy
}

export async function writeCachedMessages(chatId: string, messages: CachedMessage[]): Promise<void> {
  const database = await openMessageCacheDatabase()

  if (!database) {
    writeLegacyCachedMessages(chatId, messages)
    return
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const request = transaction.objectStore(STORE_NAME).put({
      chatId,
      messages
    })

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to persist cached messages.'))
  })

  writeLegacyCachedMessages(chatId, messages)
}

function readLegacyCachedMessages(chatId: string): CachedMessage[] {
  const raw = window.localStorage.getItem(`${CACHE_PREFIX}${chatId}`)

  if (!raw) {
    return []
  }

  try {
    return JSON.parse(raw) as CachedMessage[]
  } catch {
    window.localStorage.removeItem(`${CACHE_PREFIX}${chatId}`)
    return []
  }
}

function writeLegacyCachedMessages(chatId: string, messages: CachedMessage[]) {
  window.localStorage.setItem(`${CACHE_PREFIX}${chatId}`, JSON.stringify(messages))
}

async function openMessageCacheDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
    return null
  }

  return new Promise<IDBDatabase | null>((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'chatId' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}
