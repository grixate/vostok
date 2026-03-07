import { DESKTOP_ALWAYS_ON_TOP_STORAGE_KEY } from '../constants.ts'

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const tagName = target.tagName

  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

export function readDesktopAlwaysOnTopPreference(): boolean | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(DESKTOP_ALWAYS_ON_TOP_STORAGE_KEY)

  if (raw === 'true') {
    return true
  }

  if (raw === 'false') {
    return false
  }

  return null
}
