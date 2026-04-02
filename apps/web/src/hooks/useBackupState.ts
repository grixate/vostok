import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BackupCredentialMode } from '../lib/backup-crypto.ts'

// ---------------------------------------------------------------------------
// Backup state — tracks when the last backup was created, its expiry, and
// whether the user has dismissed reminder banners.
// ---------------------------------------------------------------------------

export type BackupState = {
  lastBackupAt: string | null
  expiresAt: string | null
  credentialMode: BackupCredentialMode | null
  serverCount: number
  reminderDismissedAt: string | null
}

export type BackupStatus = 'none' | 'fresh' | 'expiring_soon' | 'expired' | 'overdue'

const STORAGE_KEY = 'vostok.backup_state'

const EXPIRY_WARN_DAYS = 7
const OVERDUE_DAYS = 7

const DEFAULT_STATE: BackupState = {
  lastBackupAt: null,
  expiresAt: null,
  credentialMode: null,
  serverCount: 0,
  reminderDismissedAt: null,
}

// ---- persistence ----------------------------------------------------------

function load(): BackupState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    return { ...DEFAULT_STATE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_STATE
  }
}

const SYNC_EVENT = 'vostok:backup-state-changed'
let currentSaveId = 0

function save(state: BackupState): number {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  const id = ++currentSaveId
  // Notify other hook instances in the same tab
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: id }))
  return id
}

// ---- status computation ---------------------------------------------------

export function computeBackupStatus(state: BackupState): BackupStatus {
  if (!state.expiresAt) return 'none'

  const now = Date.now()
  const expires = new Date(state.expiresAt).getTime()
  const daysUntilExpiry = (expires - now) / (1000 * 60 * 60 * 24)

  if (daysUntilExpiry < -OVERDUE_DAYS) return 'overdue'
  if (daysUntilExpiry <= 0) return 'expired'
  if (daysUntilExpiry <= EXPIRY_WARN_DAYS) return 'expiring_soon'
  return 'fresh'
}

export function getBackupReminderText(state: BackupState): string | null {
  const status = computeBackupStatus(state)
  if (!state.expiresAt) return null

  const now = Date.now()
  const expires = new Date(state.expiresAt).getTime()
  const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24))

  // Check if the user dismissed the reminder at the current threshold
  if (state.reminderDismissedAt) {
    const dismissedAt = new Date(state.reminderDismissedAt).getTime()
    const dismissedDaysUntilExpiry = Math.ceil((expires - dismissedAt) / (1000 * 60 * 60 * 24))

    // If dismissed in the same threshold band, don't show again
    if (status === 'expiring_soon' && dismissedDaysUntilExpiry > 0 && dismissedDaysUntilExpiry <= EXPIRY_WARN_DAYS) {
      return null
    }
    if (status === 'expired' && dismissedDaysUntilExpiry <= 0 && dismissedDaysUntilExpiry > -OVERDUE_DAYS) {
      return null
    }
  }

  switch (status) {
    case 'expiring_soon':
      return `Your server backup expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Create a new one to keep quick restore working.`
    case 'expired':
      return 'Your server backup has expired. Quick restore won\'t work on new devices. Create a fresh backup.'
    case 'overdue':
      return 'Your server backup has expired. Quick restore won\'t work on new devices. Create a fresh backup.'
    default:
      return null
  }
}

// ---- hook -----------------------------------------------------------------

export function useBackupState() {
  const [state, setState] = useState<BackupState>(load)
  const lastSaveIdRef = { current: 0 }

  // Sync state when another hook instance in this tab writes to localStorage
  useEffect(() => {
    function handleSync(e: Event) {
      const saveId = (e as CustomEvent).detail as number
      // Skip events triggered by this hook instance
      if (saveId === lastSaveIdRef.current) return
      setState(load())
    }
    window.addEventListener(SYNC_EVENT, handleSync)
    return () => window.removeEventListener(SYNC_EVENT, handleSync)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const updateState = useCallback((patch: Partial<BackupState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch }
      lastSaveIdRef.current = save(next)
      return next
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const clearState = useCallback(() => {
    setState(DEFAULT_STATE)
    lastSaveIdRef.current = save(DEFAULT_STATE)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const dismissReminder = useCallback(() => {
    updateState({ reminderDismissedAt: new Date().toISOString() })
  }, [updateState])

  const status = useMemo(() => computeBackupStatus(state), [state])
  const reminderText = useMemo(() => getBackupReminderText(state), [state])

  return { state, status, reminderText, updateState, clearState, dismissReminder }
}
