import { useState, useEffect, useRef, useCallback } from 'react'
import { SETTINGS_STORAGE_KEY } from '../constants.ts'
import { fetchSettings, syncSettings } from '../lib/api.ts'
import type { AutoDownloadSettings } from '../types.ts'

export type UserSettings = {
  // Appearance
  appearance_timestamps: boolean
  // Notifications
  notif_desktop: boolean
  notif_sound: boolean
  notif_badge: boolean
  notif_preview: boolean
  // Privacy
  privacy_last_seen: boolean
  privacy_read_receipts: boolean
  privacy_typing_indicators: boolean
  // Sessions
  sessions_confirm_new: boolean
  sessions_auto_terminate: boolean
  // Auto-download (structured)
  auto_download?: AutoDownloadSettings
  // Storage management
  data_keep_media_seconds: number
  data_cache_limit_bytes: number
}

export const DEFAULT_SETTINGS: UserSettings = {
  // Appearance
  appearance_timestamps: true,
  // Notifications
  notif_desktop: true,
  notif_sound: true,
  notif_badge: true,
  notif_preview: true,
  // Privacy
  privacy_last_seen: true,
  privacy_read_receipts: true,
  privacy_typing_indicators: true,
  // Sessions
  sessions_confirm_new: false,
  sessions_auto_terminate: false,
  // Storage management
  data_keep_media_seconds: 2592000,  // 30 days
  data_cache_limit_bytes: 1073741824, // 1 GB
}

function readFromStorage(): Partial<UserSettings> | null {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Partial<UserSettings>
  } catch {
    return null
  }
}

function writeToStorage(settings: UserSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

export function useSettings(token: string | null) {
  const [settings, setSettingsRaw] = useState<UserSettings>(() => {
    const stored = readFromStorage()
    return stored ? { ...DEFAULT_SETTINGS, ...stored } : { ...DEFAULT_SETTINGS }
  })
  const [synced, setSynced] = useState(false)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch from server on mount and merge
  useEffect(() => {
    if (!token) return
    fetchSettings(token)
      .then((remote) => {
        if (remote && typeof remote === 'object') {
          const local = readFromStorage() ?? {}
          const merged = { ...DEFAULT_SETTINGS, ...(remote as Partial<UserSettings>), ...local }
          setSettingsRaw(merged)
          writeToStorage(merged)
        }
        setSynced(true)
      })
      .catch(() => {
        setSynced(true) // offline is fine, we have localStorage
      })
  }, [token])

  const debouncedSync = useCallback(
    (next: UserSettings) => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(() => {
        if (token) {
          syncSettings(token, next as unknown as Record<string, unknown>).catch(() => {
            // silent fail — localStorage is the source of truth
          })
        }
      }, 2000)
    },
    [token]
  )

  const updateSetting = useCallback(
    <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
      setSettingsRaw((prev) => {
        const next = { ...prev, [key]: value }
        writeToStorage(next)
        debouncedSync(next)
        return next
      })
    },
    [debouncedSync]
  )

  const toggle = useCallback(
    (key: keyof UserSettings) => {
      setSettingsRaw((prev) => {
        const next = { ...prev, [key]: !prev[key] }
        writeToStorage(next)
        debouncedSync(next)
        return next
      })
    },
    [debouncedSync]
  )

  const resetGroup = useCallback(
    (prefix: string) => {
      setSettingsRaw((prev) => {
        const next = { ...prev }
        for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof UserSettings)[]) {
          if (key.startsWith(prefix)) {
            ;(next as Record<string, unknown>)[key] = DEFAULT_SETTINGS[key]
          }
        }
        writeToStorage(next)
        debouncedSync(next)
        return next
      })
    },
    [debouncedSync]
  )

  return { settings, updateSetting, toggle, resetGroup, synced }
}
