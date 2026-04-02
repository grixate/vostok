/**
 * Client-side storage management utilities.
 *
 * Handles storage estimation, media cache eviction, and conversation cleanup
 * per the data architecture spec Section 3.3.
 */

import { getStorageEstimate, clearAllCaches } from './message-cache.ts'

export type StoragePolicy = {
  mediaCacheMaxBytes: number      // Default: 2GB
  autoDownloadThreshold: number   // Default: 10MB
  keepMessagesDays: number | null // null = forever, else 30/90/365
  vacuumIntervalDays: number      // Default: 7
}

export const DEFAULT_STORAGE_POLICY: StoragePolicy = {
  mediaCacheMaxBytes: 2 * 1024 * 1024 * 1024,   // 2GB
  autoDownloadThreshold: 10 * 1024 * 1024,        // 10MB
  keepMessagesDays: null,                          // Forever
  vacuumIntervalDays: 7,
}

/**
 * Get storage usage info in human-readable format.
 */
export async function getStorageInfo(): Promise<{
  usageBytes: number
  quotaBytes: number
  usagePercent: number
  usageFormatted: string
  quotaFormatted: string
} | null> {
  const estimate = await getStorageEstimate()
  if (!estimate) return null

  return {
    usageBytes: estimate.usage,
    quotaBytes: estimate.quota,
    usagePercent: estimate.quota > 0 ? (estimate.usage / estimate.quota) * 100 : 0,
    usageFormatted: formatBytes(estimate.usage),
    quotaFormatted: formatBytes(estimate.quota),
  }
}

/**
 * Clear all local data (messages, conversations, contacts, media cache).
 * Used for "Clear Cache" in settings.
 */
export async function clearLocalData(): Promise<void> {
  await clearAllCaches()
}

/**
 * Format bytes into human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}
