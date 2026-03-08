import { createContext, useContext, type Dispatch, type SetStateAction } from 'react'
import type { StoredDevice, Banner } from '../types.ts'

export type AppContextValue = {
  storedDevice: StoredDevice | null
  setStoredDevice: Dispatch<SetStateAction<StoredDevice | null>>
  banner: Banner | null
  setBanner: Dispatch<SetStateAction<Banner | null>>
  loading: boolean
  setLoading: Dispatch<SetStateAction<boolean>>
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useAppContext(): AppContextValue {
  const value = useContext(AppContext)

  if (!value) {
    throw new Error('useAppContext must be used within an AppContext.Provider')
  }

  return value
}
