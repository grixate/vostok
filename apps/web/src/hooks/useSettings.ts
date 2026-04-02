import { useState, useEffect, useRef, useCallback } from 'react'
import { SETTINGS_STORAGE_KEY } from '../constants.ts'
import { fetchSettings, syncSettings } from '../lib/api.ts'

export type UserSettings = {
  // General
  general_autocorrect: boolean
  general_capitalize: boolean
  general_spelling: boolean
  general_replace_emoji: boolean
  general_suggest_emoji: boolean
  general_large_emoji: boolean
  general_unread_counter: boolean
  general_compact: boolean
  general_show_avatars: boolean
  general_animations: boolean
  general_send_key: 'enter' | 'ctrl-enter'
  // Appearance
  appearance_timestamps: boolean
  // Notifications
  notif_desktop: boolean
  notif_sound: boolean
  notif_badge: boolean
  notif_preview: boolean
  notif_in_app: boolean
  notif_flash_window: boolean
  notif_private_msg: boolean
  notif_private_mention: boolean
  notif_private_preview: boolean
  notif_group_msg: boolean
  notif_group_mention: boolean
  notif_group_preview: boolean
  notif_chan_msg: boolean
  notif_chan_mention: boolean
  notif_chan_preview: boolean
  // Privacy
  privacy_last_seen: boolean
  privacy_profile_photo: boolean
  privacy_online_status: boolean
  privacy_read_receipts: boolean
  privacy_typing_indicators: boolean
  privacy_two_factor: boolean
  privacy_login_alerts: boolean
  privacy_session_log: boolean
  // Data & Storage
  data_auto_photos: boolean
  data_auto_videos: boolean
  data_auto_documents: boolean
  data_auto_voice: boolean
  // Chat Folders
  folders_show_tabs: boolean
  // Sessions
  sessions_confirm_new: boolean
  sessions_auto_terminate: boolean
}

export const DEFAULT_SETTINGS: UserSettings = {
  // General
  general_autocorrect: true,
  general_capitalize: false,
  general_spelling: false,
  general_replace_emoji: true,
  general_suggest_emoji: false,
  general_large_emoji: true,
  general_unread_counter: true,
  general_compact: false,
  general_show_avatars: false,
  general_animations: true,
  general_send_key: 'enter',
  // Appearance
  appearance_timestamps: true,
  // Notifications
  notif_desktop: true,
  notif_sound: true,
  notif_badge: true,
  notif_preview: true,
  notif_in_app: true,
  notif_flash_window: false,
  notif_private_msg: true,
  notif_private_mention: false,
  notif_private_preview: false,
  notif_group_msg: true,
  notif_group_mention: false,
  notif_group_preview: false,
  notif_chan_msg: true,
  notif_chan_mention: false,
  notif_chan_preview: false,
  // Privacy
  privacy_last_seen: true,
  privacy_profile_photo: true,
  privacy_online_status: true,
  privacy_read_receipts: true,
  privacy_typing_indicators: true,
  privacy_two_factor: false,
  privacy_login_alerts: true,
  privacy_session_log: true,
  // Data & Storage
  data_auto_photos: true,
  data_auto_videos: false,
  data_auto_documents: false,
  data_auto_voice: false,
  // Chat Folders
  folders_show_tabs: true,
  // Sessions
  sessions_confirm_new: false,
  sessions_auto_terminate: false,
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
