import { createContext, useContext, useState, type ReactNode } from 'react'
import type { StoredDevice, Banner } from '../types'
import { readStoredDevice } from '../utils/storage'

export type AppContextValue = {
  storedDevice: StoredDevice | null
  setStoredDevice: React.Dispatch<React.SetStateAction<StoredDevice | null>>
  banner: Banner | null
  setBanner: React.Dispatch<React.SetStateAction<Banner | null>>
  loading: boolean
  setLoading: React.Dispatch<React.SetStateAction<boolean>>
}

const AppContext = createContext<AppContextValue | null>(null)

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)

  if (!ctx) {
    throw new Error('useAppContext must be used within an AppProvider')
  }

  return ctx
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [storedDevice, setStoredDevice] = useState<StoredDevice | null>(() => readStoredDevice())
  const [banner, setBanner] = useState<Banner | null>(null)
  const [loading, setLoading] = useState(false)

  return (
    <AppContext.Provider value={{ storedDevice, setStoredDevice, banner, setBanner, loading, setLoading }}>
      {children}
    </AppContext.Provider>
  )
}
