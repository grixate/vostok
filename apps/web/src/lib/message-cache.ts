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

export type ForwardedFrom = {
  chatId: string
  messageId: string
  senderName: string
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
  forwardedFrom?: ForwardedFrom
  reactions?: Array<{
    reactionKey: string
    count: number
    reacted: boolean
  }>
  // Phase 1: new fields for client-as-source-of-truth
  contentType?: number       // 1=text, 2=image, 3=video, 4=file, 5=voice, 6=sticker, 9=system
  status?: number            // 0=sending, 1=sent, 2=delivered, 3=read, 4=failed
  receivedAt?: string        // Local receive time (ISO string)
  mediaMetadata?: string     // JSON string: {blob_id, file_name, size, mime, width, height, duration}
  viewCount?: number         // Channel post view count
}

export type CachedConversation = {
  id: string
  type: number               // 1=direct, 2=group, 3=channel
  title: string | null
  createdAt: string
  updatedAt: string
  lastMessageId: string | null
  draftText: string | null
  mutedUntil: string | null
  pinned: boolean
  archived: boolean
}

export type CachedContact = {
  userId: string
  username: string
  displayName: string | null
  serverDomain: string
  identityKey: string | null
  verified: boolean
  blocked: boolean
  updatedAt: string
}

const PREVIEW_PREFIX = 'vostok.chat-preview.'

/** Store the last decrypted message text for a chat (shown in the sidebar). */
export function writeChatPreview(chatId: string, text: string): void {
  try {
    window.localStorage.setItem(`${PREVIEW_PREFIX}${chatId}`, text)
  } catch {
    // Storage full or unavailable — no-op.
  }
}

/** Read the last decrypted message text for a chat (shown in the sidebar). */
export function readChatPreview(chatId: string): string | null {
  try {
    return window.localStorage.getItem(`${PREVIEW_PREFIX}${chatId}`) || null
  } catch {
    return null
  }
}

const CACHE_PREFIX = 'vostok.chat-cache.'
const DB_NAME = 'vostok-offline'
const DB_VERSION = 2  // Bumped from 1 → 2 for Phase 1 schema upgrade

// ── IndexedDB store names ───────────────────────────────────────────────
const STORE_MESSAGES = 'messages'
const STORE_CONVERSATIONS = 'conversations'
const STORE_CONTACTS = 'contacts'
const STORE_MEDIA_CACHE = 'media_cache'

// ── Message cache (upgraded) ────────────────────────────────────────────

export async function readCachedMessages(chatId: string): Promise<CachedMessage[]> {
  const database = await openMessageCacheDatabase()

  if (!database) {
    return readLegacyCachedMessages(chatId)
  }

  const persisted = await new Promise<CachedMessage[] | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_MESSAGES, 'readonly')
    const request = transaction.objectStore(STORE_MESSAGES).get(chatId)

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
    const transaction = database.transaction(STORE_MESSAGES, 'readwrite')
    const request = transaction.objectStore(STORE_MESSAGES).put({
      chatId,
      messages
    })

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to persist cached messages.'))
  })

  writeLegacyCachedMessages(chatId, messages)
}

// ── Conversation cache ──────────────────────────────────────────────────

export async function readCachedConversations(): Promise<CachedConversation[]> {
  const database = await openMessageCacheDatabase()
  if (!database) return []

  return new Promise<CachedConversation[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_CONVERSATIONS, 'readonly')
    const request = transaction.objectStore(STORE_CONVERSATIONS).getAll()
    request.onsuccess = () => resolve(request.result ?? [])
    request.onerror = () => reject(request.error ?? new Error('Failed to read conversations.'))
  })
}

export async function writeCachedConversation(conversation: CachedConversation): Promise<void> {
  const database = await openMessageCacheDatabase()
  if (!database) return

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_CONVERSATIONS, 'readwrite')
    const request = transaction.objectStore(STORE_CONVERSATIONS).put(conversation)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to write conversation.'))
  })
}

// ── Contact cache ───────────────────────────────────────────────────────

export async function readCachedContacts(): Promise<CachedContact[]> {
  const database = await openMessageCacheDatabase()
  if (!database) return []

  return new Promise<CachedContact[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_CONTACTS, 'readonly')
    const request = transaction.objectStore(STORE_CONTACTS).getAll()
    request.onsuccess = () => resolve(request.result ?? [])
    request.onerror = () => reject(request.error ?? new Error('Failed to read contacts.'))
  })
}

export async function writeCachedContact(contact: CachedContact): Promise<void> {
  const database = await openMessageCacheDatabase()
  if (!database) return

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_CONTACTS, 'readwrite')
    const request = transaction.objectStore(STORE_CONTACTS).put(contact)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to write contact.'))
  })
}

// ── Cross-chat message search ───────────────────────────────────────────

export type SearchResult = {
  chatId: string
  message: CachedMessage
}

export async function searchAllCachedMessages(
  query: string,
  limit = 50
): Promise<SearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []

  const database = await openMessageCacheDatabase()
  if (!database) return searchLegacyCachedMessages(normalizedQuery, limit)

  const results: SearchResult[] = []

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_MESSAGES, 'readonly')
    const store = transaction.objectStore(STORE_MESSAGES)
    const request = store.openCursor()

    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || results.length >= limit) {
        resolve()
        return
      }

      const record = cursor.value as { chatId: string; messages: CachedMessage[] }
      if (Array.isArray(record?.messages)) {
        for (const msg of record.messages) {
          if (results.length >= limit) break
          if (
            !msg.deletedAt &&
            msg.text &&
            msg.text.toLowerCase().includes(normalizedQuery)
          ) {
            results.push({ chatId: record.chatId, message: msg })
          }
        }
      }

      cursor.continue()
    }

    request.onerror = () => reject(request.error)
  })

  return results
}

function searchLegacyCachedMessages(query: string, limit: number): SearchResult[] {
  const results: SearchResult[] = []

  for (let i = 0; i < window.localStorage.length && results.length < limit; i++) {
    const key = window.localStorage.key(i)
    if (!key?.startsWith(CACHE_PREFIX)) continue

    const chatId = key.slice(CACHE_PREFIX.length)

    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const messages = JSON.parse(raw) as CachedMessage[]

      for (const msg of messages) {
        if (results.length >= limit) break
        if (!msg.deletedAt && msg.text?.toLowerCase().includes(query)) {
          results.push({ chatId, message: msg })
        }
      }
    } catch {
      // Ignore corrupt entries
    }
  }

  return results
}

// ── Storage management ──────────────────────────────────────────────────

export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate()
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  }
  return null
}

export async function clearAllCaches(): Promise<void> {
  const database = await openMessageCacheDatabase()
  if (!database) return

  const storeNames = [STORE_MESSAGES, STORE_CONVERSATIONS, STORE_CONTACTS, STORE_MEDIA_CACHE]
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeNames, 'readwrite')
    for (const name of storeNames) {
      transaction.objectStore(name).clear()
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })

  // Clear legacy localStorage caches too
  const keysToRemove: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (key && (key.startsWith(CACHE_PREFIX) || key.startsWith(PREVIEW_PREFIX))) {
      keysToRemove.push(key)
    }
  }
  for (const key of keysToRemove) {
    window.localStorage.removeItem(key)
  }
}

// ── Legacy localStorage fallback ────────────────────────────────────────

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

// ── Database initialization ─────────────────────────────────────────────

async function openMessageCacheDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
    return null
  }

  return new Promise<IDBDatabase | null>((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const database = request.result
      const oldVersion = event.oldVersion

      // V1 → V2 migration: add conversations, contacts, media_cache stores
      if (oldVersion < 1) {
        database.createObjectStore(STORE_MESSAGES, { keyPath: 'chatId' })
      }

      if (oldVersion < 2) {
        if (!database.objectStoreNames.contains(STORE_CONVERSATIONS)) {
          database.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORE_CONTACTS)) {
          database.createObjectStore(STORE_CONTACTS, { keyPath: 'userId' })
        }
        if (!database.objectStoreNames.contains(STORE_MEDIA_CACHE)) {
          const mediaStore = database.createObjectStore(STORE_MEDIA_CACHE, { keyPath: 'blobId' })
          mediaStore.createIndex('lastAccessed', 'lastAccessed')
        }
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}
