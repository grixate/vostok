import { createContext, useContext, type ReactNode } from 'react'
import {
  useOnboardingNav,
  useAppNav,
  type NavigationStack,
  type OnboardingScreen,
  type AppScreen,
} from '../hooks/useNavigation'

// ─── Context ───────────────────────────────────────────────────────────────

export type UIContextValue = {
  onboardingNav: NavigationStack<OnboardingScreen>
  appNav: NavigationStack<AppScreen>
}

export const UIContext = createContext<UIContextValue | null>(null)

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}

export function UIProvider({ children }: { children: ReactNode }) {
  const onboardingNav = useOnboardingNav('welcome')
  const appNav = useAppNav('chat-list')

  return (
    <UIContext.Provider value={{ onboardingNav, appNav }}>
      {children}
    </UIContext.Provider>
  )
}
