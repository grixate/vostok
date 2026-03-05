type OutboxRecord = {
  id: string
  chatId: string
  payload: {
    client_id: string
    ciphertext: string
    message_kind: string
    header?: string
    crypto_scheme?: string
    sender_key_id?: string
    sender_key_epoch?: number
    reply_to_message_id?: string
    recipient_envelopes?: Record<string, string>
    established_session_ids?: string[]
  }
  createdAt: string
  attemptCount: number
  nextAttemptAt: number
  lastError: string | null
}

const DB_NAME = 'vostok-offline-outbox'
const STORE_NAME = 'outbox'
const DB_VERSION = 1
const LEGACY_STORAGE_KEY = 'vostok.outbox.fallback'

export async function queueOutboxMessage(
  entry: Omit<OutboxRecord, 'attemptCount' | 'nextAttemptAt' | 'lastError'> & Partial<OutboxRecord>
): Promise<void> {
  const record: OutboxRecord = {
    id: entry.id,
    chatId: entry.chatId,
    payload: entry.payload,
    createdAt: entry.createdAt,
    attemptCount: entry.attemptCount ?? 0,
    nextAttemptAt: entry.nextAttemptAt ?? Date.now(),
    lastError: entry.lastError ?? null
  }

  const database = await openDatabase()

  if (!database) {
    const existing = readLegacyRecords()
    const next = [...existing.filter((value) => value.id !== record.id), record]
    writeLegacyRecords(next)
    return
  }

  await requestAsPromise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const request = transaction.objectStore(STORE_NAME).put(record)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to queue outbox message.'))
  })
}

export async function listDueOutboxMessages(limit: number): Promise<OutboxRecord[]> {
  const now = Date.now()
  const records = await listOutboxMessages()

  return records
    .filter((entry) => entry.nextAttemptAt <= now)
    .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt || left.createdAt.localeCompare(right.createdAt))
    .slice(0, Math.max(1, limit))
}

export async function listOutboxMessages(): Promise<OutboxRecord[]> {
  const database = await openDatabase()

  if (!database) {
    return readLegacyRecords().sort(byCreatedAt)
  }

  return requestAsPromise<OutboxRecord[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).getAll()

    request.onsuccess = () => {
      const values = Array.isArray(request.result) ? (request.result as OutboxRecord[]) : []
      resolve(values.sort(byCreatedAt))
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to read outbox queue.'))
  })
}

export async function countOutboxMessages(): Promise<number> {
  const database = await openDatabase()

  if (!database) {
    return readLegacyRecords().length
  }

  return requestAsPromise<number>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).count()

    request.onsuccess = () => resolve(Number(request.result) || 0)
    request.onerror = () => reject(request.error ?? new Error('Failed to count outbox messages.'))
  })
}

export async function markOutboxRetry(
  id: string,
  attemptCount: number,
  retryDelayMs: number,
  lastError: string
): Promise<void> {
  const database = await openDatabase()

  if (!database) {
    const existing = readLegacyRecords()
    const next = existing.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            attemptCount,
            nextAttemptAt: Date.now() + Math.max(1_000, retryDelayMs),
            lastError
          }
        : entry
    )
    writeLegacyRecords(next)
    return
  }

  await requestAsPromise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const readRequest = store.get(id)

    readRequest.onsuccess = () => {
      const existing = readRequest.result as OutboxRecord | undefined

      if (!existing) {
        resolve()
        return
      }

      const writeRequest = store.put({
        ...existing,
        attemptCount,
        nextAttemptAt: Date.now() + Math.max(1_000, retryDelayMs),
        lastError
      } satisfies OutboxRecord)

      writeRequest.onsuccess = () => resolve()
      writeRequest.onerror = () =>
        reject(writeRequest.error ?? new Error('Failed to update outbox retry metadata.'))
    }

    readRequest.onerror = () =>
      reject(readRequest.error ?? new Error('Failed to read outbox record for retry update.'))
  })
}

export async function deleteOutboxMessage(id: string): Promise<void> {
  const database = await openDatabase()

  if (!database) {
    writeLegacyRecords(readLegacyRecords().filter((entry) => entry.id !== id))
    return
  }

  await requestAsPromise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const request = transaction.objectStore(STORE_NAME).delete(id)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to remove outbox message.'))
  })
}

function byCreatedAt(left: OutboxRecord, right: OutboxRecord): number {
  return left.createdAt.localeCompare(right.createdAt)
}

function readLegacyRecords(): OutboxRecord[] {
  if (typeof window === 'undefined') {
    return []
  }

  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)

  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(isOutboxRecord)
  } catch {
    return []
  }
}

function writeLegacyRecords(records: OutboxRecord[]): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(records))
}

function isOutboxRecord(value: unknown): value is OutboxRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const entry = value as Partial<OutboxRecord>

  return (
    typeof entry.id === 'string' &&
    typeof entry.chatId === 'string' &&
    typeof entry.createdAt === 'string' &&
    typeof entry.attemptCount === 'number' &&
    typeof entry.nextAttemptAt === 'number' &&
    typeof entry.payload === 'object' &&
    entry.payload !== null
  )
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
    return null
  }

  return new Promise<IDBDatabase | null>((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

function requestAsPromise<T>(
  builder: (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    builder(resolve, reject)
  })
}

