import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { getLocale, setLocale as setGlobalLocale, type Locale } from '../lib/i18n.ts'

type LocaleContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  setLocale: () => {}
})

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale)

  const setLocale = useCallback((next: Locale) => {
    setGlobalLocale(next)
    setLocaleState(next)
  }, [])

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  return useContext(LocaleContext)
}
