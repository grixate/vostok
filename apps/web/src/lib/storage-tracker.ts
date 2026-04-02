import type { MediaKind } from '../types.ts'

// ─── Types ──────────────────────────────────────────────────────────────────────

export type StorageCategory = MediaKind | 'other'

export type StorageEntry = {
  uploadId: string
  category: StorageCategory
  chatId: string
  sizeBytes: number
  cachedAt: number
  lastAccessedAt: number
}

export type StorageBreakdown = {
  total_bytes: number
  by_category: Record<StorageCategory, number>
  by_chat: { chatId: string; bytes: number }[]
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'vostok.storage_tracker'

const EMPTY_CATEGORIES: Record<StorageCategory, number> = {
  photos: 0,
  videos: 0,
  files: 0,
  voice_messages: 0,
  round_videos: 0,
  other: 0,
}

// ─── StorageTracker ─────────────────────────────────────────────────────────────

export class StorageTracker {
  private entries = new Map<string, StorageEntry>()
  private listeners = new Set<() => void>()

  constructor() {
    this.load()
  }

  // ── Recording ────────────────────────────────────────────────────────────

  record(uploadId: string, category: StorageCategory, chatId: string, sizeBytes: number): void {
    this.entries.set(uploadId, {
      uploadId,
      category,
      chatId,
      sizeBytes,
      cachedAt: Date.now(),
      lastAccessedAt: Date.now(),
    })
    this.save()
    this.notify()
  }

  remove(uploadId: string): void {
    if (this.entries.delete(uploadId)) {
      this.save()
      this.notify()
    }
  }

  removeByCategory(category: StorageCategory): string[] {
    const removed: string[] = []
    for (const [id, entry] of this.entries) {
      if (entry.category === category) {
        removed.push(id)
        this.entries.delete(id)
      }
    }
    if (removed.length > 0) {
      this.save()
      this.notify()
    }
    return removed
  }

  removeByChat(chatId: string): string[] {
    const removed: string[] = []
    for (const [id, entry] of this.entries) {
      if (entry.chatId === chatId) {
        removed.push(id)
        this.entries.delete(id)
      }
    }
    if (removed.length > 0) {
      this.save()
      this.notify()
    }
    return removed
  }

  removeAll(): string[] {
    const removed = [...this.entries.keys()]
    this.entries.clear()
    this.save()
    this.notify()
    return removed
  }

  updateLastAccessed(uploadId: string): void {
    const entry = this.entries.get(uploadId)
    if (entry) {
      entry.lastAccessedAt = Date.now()
      // Don't save on every access — batch saves happen on next record/remove
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  getBreakdown(): StorageBreakdown {
    const by_category = { ...EMPTY_CATEGORIES }
    const chatMap = new Map<string, number>()
    let total = 0

    for (const entry of this.entries.values()) {
      by_category[entry.category] = (by_category[entry.category] ?? 0) + entry.sizeBytes
      chatMap.set(entry.chatId, (chatMap.get(entry.chatId) ?? 0) + entry.sizeBytes)
      total += entry.sizeBytes
    }

    const by_chat = [...chatMap.entries()]
      .map(([chatId, bytes]) => ({ chatId, bytes }))
      .sort((a, b) => b.bytes - a.bytes)

    return { total_bytes: total, by_category, by_chat }
  }

  getTotalCachedBytes(): number {
    let total = 0
    for (const entry of this.entries.values()) {
      total += entry.sizeBytes
    }
    return total
  }

  getOldestEntry(): StorageEntry | null {
    let oldest: StorageEntry | null = null
    for (const entry of this.entries.values()) {
      if (!oldest || entry.lastAccessedAt < oldest.lastAccessedAt) {
        oldest = entry
      }
    }
    return oldest
  }

  getAllEntries(): StorageEntry[] {
    return [...this.entries.values()]
  }

  has(uploadId: string): boolean {
    return this.entries.has(uploadId)
  }

  // ── Subscriptions ────────────────────────────────────────────────────────

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const arr = JSON.parse(raw) as StorageEntry[]
      for (const entry of arr) {
        this.entries.set(entry.uploadId, entry)
      }
    } catch {
      // Corrupted data — start fresh
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.entries.values()]))
    } catch {
      // Storage full — best effort
    }
  }

  private notify(): void {
    for (const cb of this.listeners) {
      try { cb() } catch { /* ignore */ }
    }
  }
}

// ─── Eviction helpers ───────────────────────────────────────────────────────────

export function evictExpiredMedia(
  tracker: StorageTracker,
  evictFn: (uploadId: string) => void,
  keepMediaSeconds: number,
): number {
  if (keepMediaSeconds === 0) return 0

  const cutoff = Date.now() - keepMediaSeconds * 1000
  let evicted = 0

  for (const entry of tracker.getAllEntries()) {
    if (entry.cachedAt < cutoff) {
      evictFn(entry.uploadId)
      tracker.remove(entry.uploadId)
      evicted++
    }
  }

  return evicted
}

export function enforceCacheLimit(
  tracker: StorageTracker,
  evictFn: (uploadId: string) => void,
  limitBytes: number,
): number {
  if (limitBytes === 0) return 0

  let evicted = 0
  while (tracker.getTotalCachedBytes() > limitBytes) {
    const oldest = tracker.getOldestEntry()
    if (!oldest) break
    evictFn(oldest.uploadId)
    tracker.remove(oldest.uploadId)
    evicted++
  }

  return evicted
}
