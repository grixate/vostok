type SecureKvRecord = {
  key: string
  value: string
  updatedAt: string
}

const DB_NAME = 'vostok-secure-store'
const STORE_NAME = 'kv'
const DB_VERSION = 1

let databasePromise: Promise<IDBDatabase | null> | null = null

export async function bootstrapSecureStore(prefixes: string[]): Promise<void> {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return
  }

  const normalizedPrefixes = [...new Set(prefixes.map((value) => value.trim()).filter(Boolean))]

  if (normalizedPrefixes.length === 0) {
    return
  }

  const database = await openDatabase()

  if (!database) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const now = new Date().toISOString()

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)

      if (!key || !normalizedPrefixes.some((prefix) => key.startsWith(prefix))) {
        continue
      }

      const value = window.localStorage.getItem(key)

      if (typeof value !== 'string') {
        continue
      }

      store.put({
        key,
        value,
        updatedAt: now
      } satisfies SecureKvRecord)
    }

    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to migrate secure store keys.'))
  })

  const persisted = await readAllRecords(database)

  for (const record of persisted) {
    if (!normalizedPrefixes.some((prefix) => record.key.startsWith(prefix))) {
      continue
    }

    if (window.localStorage.getItem(record.key) == null) {
      window.localStorage.setItem(record.key, record.value)
    }
  }
}

export function persistSecureStoreValue(key: string, value: string): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return
  }

  window.localStorage.setItem(key, value)
  void writeRecord(key, value)
}

export function removeSecureStoreValue(key: string): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return
  }

  window.localStorage.removeItem(key)
  void deleteRecord(key)
}

async function writeRecord(key: string, value: string): Promise<void> {
  const database = await openDatabase()

  if (!database) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const request = transaction.objectStore(STORE_NAME).put({
      key,
      value,
      updatedAt: new Date().toISOString()
    } satisfies SecureKvRecord)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to persist secure key entry.'))
  }).catch(() => undefined)
}

async function deleteRecord(key: string): Promise<void> {
  const database = await openDatabase()

  if (!database) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const request = transaction.objectStore(STORE_NAME).delete(key)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to remove secure key entry.'))
  }).catch(() => undefined)
}

async function readAllRecords(database: IDBDatabase): Promise<SecureKvRecord[]> {
  return new Promise<SecureKvRecord[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).getAll()

    request.onsuccess = () => {
      const values = Array.isArray(request.result) ? (request.result as SecureKvRecord[]) : []
      resolve(values)
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to read secure key entries.'))
  }).catch(() => [])
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
    return null
  }

  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase | null>((resolve) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const database = request.result

        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
  }

  return databasePromise
}
