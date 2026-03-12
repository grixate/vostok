import { createContext, useContext } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export type ThemeContextValue = {
  themePreference: ThemePreference
  setThemePreference: (pref: ThemePreference) => void
  resolvedTheme: ResolvedTheme
  accentColor: string
  setAccentColor: (color: string) => void
  chatBackground: string | null
  setChatBackground: (bg: string | null) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useThemeContext(): ThemeContextValue {
  const value = useContext(ThemeContext)

  if (!value) {
    throw new Error('useThemeContext must be used within a ThemeContext.Provider')
  }

  return value
}
