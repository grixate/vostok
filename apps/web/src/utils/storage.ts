import type { StoredDevice } from '../types'
import type { DesktopWindowGeometry } from '../lib/desktop-shell'
import {
  STORAGE_KEY,
  DETAIL_RAIL_STORAGE_KEY,
  DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY,
  DESKTOP_DETAIL_RAIL_BREAKPOINT
} from '../constants'

export function readStoredDevice(): StoredDevice | null {
  const raw = window.localStorage.getItem(STORAGE_KEY)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as StoredDevice
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function persistStoredDevice(device: StoredDevice | null) {
  if (device) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(device))
    return
  }

  window.localStorage.removeItem(STORAGE_KEY)
}

export function readDetailRailPreference(): boolean {
  if (typeof window === 'undefined') {
    return true
  }

  const raw = window.localStorage.getItem(DETAIL_RAIL_STORAGE_KEY)

  if (raw === 'true') {
    return true
  }

  if (raw === 'false') {
    return false
  }

  return window.innerWidth >= DESKTOP_DETAIL_RAIL_BREAKPOINT
}

export function readDesktopWindowGeometry(): DesktopWindowGeometry | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY)

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DesktopWindowGeometry>

    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return {
        x: parsed.x,
        y: parsed.y,
        width: parsed.width,
        height: parsed.height
      }
    }
  } catch {
    // Fall through to remove invalid desktop geometry state.
  }

  window.localStorage.removeItem(DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY)
  return null
}
