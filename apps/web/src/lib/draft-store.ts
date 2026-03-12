const DB_NAME = 'vostok-drafts'
const STORE_NAME = 'drafts'
const DB_VERSION = 1

export type DraftEntry = {
  chatId: string
  text: string
  replyToMessageId?: string | null
}

async function openDraftDatabase(): Promise<IDBDatabase | null> {
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

export async function readDraft(chatId: string): Promise<DraftEntry | null> {
  const database = await openDraftDatabase()

  if (!database) {
    return null
  }

  return new Promise<DraftEntry | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(chatId)

    request.onsuccess = () => {
      const result = request.result as DraftEntry | undefined
      resolve(result ?? null)
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to read draft.'))
  })
}

export async function writeDraft(draft: DraftEntry): Promise<void> {
  const database = await openDraftDatabase()

  if (!database) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const request = transaction.objectStore(STORE_NAME).put(draft)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to write draft.'))
  })
}

export async function clearDraft(chatId: string): Promise<void> {
  const database = await openDraftDatabase()

  if (!database) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const request = transaction.objectStore(STORE_NAME).delete(chatId)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to clear draft.'))
  })
}

export async function listDraftChatIds(): Promise<string[]> {
  const database = await openDraftDatabase()

  if (!database) {
    return []
  }

  return new Promise<string[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).getAllKeys()

    request.onsuccess = () => {
      const keys = request.result as IDBValidKey[]
      resolve(keys.filter((key): key is string => typeof key === 'string'))
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to list draft chat IDs.'))
  })
}
