import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ThemeContextValue, ThemePreference, ResolvedTheme } from '../contexts/ThemeContext.tsx'

const STORAGE_KEY_MODE = 'vostok.theme.mode'
const STORAGE_KEY_ACCENT = 'vostok.theme.accent'
const STORAGE_KEY_CHAT_BG = 'vostok.theme.chat_background'

const DEFAULT_ACCENT = '#008BFF'

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function subscribeToSystemTheme(callback: () => void) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function computeAccentSoft(hex: string): string {
  // Parse hex to RGB components and create a 15% opacity version
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, 0.15)`
}

function applyThemeToDOM(preference: ThemePreference) {
  const attr = preference === 'system' ? 'system' : preference
  document.documentElement.setAttribute('data-theme', attr)
}

function applyAccentToDOM(hex: string) {
  document.documentElement.style.setProperty('--accent', hex)
  document.documentElement.style.setProperty('--accent-soft', computeAccentSoft(hex))
}

function applyChatBgToDOM(bg: string | null) {
  if (bg) {
    document.documentElement.style.setProperty('--chat-bg', bg)
  } else {
    document.documentElement.style.removeProperty('--chat-bg')
  }
}

export function useTheme(): ThemeContextValue {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => {
    const stored = localStorage.getItem(STORAGE_KEY_MODE)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
    return 'system'
  })

  const [accentColor, setAccentColorState] = useState<string>(() => {
    const stored = localStorage.getItem(STORAGE_KEY_ACCENT)
    return stored && /^#[0-9a-fA-F]{6}$/.test(stored) ? stored : DEFAULT_ACCENT
  })

  const [chatBackground, setChatBackgroundState] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY_CHAT_BG) || null
  })

  // Listen for system theme changes so resolvedTheme updates reactively
  const systemTheme = useSyncExternalStore(subscribeToSystemTheme, getSystemTheme, () => 'light' as ResolvedTheme)

  const resolvedTheme: ResolvedTheme = themePreference === 'system' ? systemTheme : themePreference

  // Apply data-theme attribute whenever preference changes
  useEffect(() => {
    applyThemeToDOM(themePreference)
  }, [themePreference])

  // Apply accent color CSS variables
  useEffect(() => {
    applyAccentToDOM(accentColor)
  }, [accentColor])

  // Apply chat background CSS variable
  useEffect(() => {
    applyChatBgToDOM(chatBackground)
  }, [chatBackground])

  const setThemePreference = useCallback((pref: ThemePreference) => {
    setThemePreferenceState(pref)
    localStorage.setItem(STORAGE_KEY_MODE, pref)
  }, [])

  const setAccentColor = useCallback((color: string) => {
    setAccentColorState(color)
    localStorage.setItem(STORAGE_KEY_ACCENT, color)
  }, [])

  const setChatBackground = useCallback((bg: string | null) => {
    setChatBackgroundState(bg)
    if (bg) {
      localStorage.setItem(STORAGE_KEY_CHAT_BG, bg)
    } else {
      localStorage.removeItem(STORAGE_KEY_CHAT_BG)
    }
  }, [])

  return useMemo(() => ({
    themePreference,
    setThemePreference,
    resolvedTheme,
    accentColor,
    setAccentColor,
    chatBackground,
    setChatBackground
  }), [themePreference, setThemePreference, resolvedTheme, accentColor, setAccentColor, chatBackground, setChatBackground])
}
