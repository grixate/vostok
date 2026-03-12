import {
  createContext,
  useContext,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import type { CachedMessage } from '../lib/message-cache.ts'

export type ContextMenuState = {
  message: CachedMessage
  x: number
  y: number
}

export type Toast = {
  id: string
  message: string
  tone: string
}

export type SidebarTab = 'chats' | 'members' | 'settings'

export type UIContextValue = {
  contextMenuMessage: ContextMenuState | null
  setContextMenuMessage: Dispatch<SetStateAction<ContextMenuState | null>>
  chatSearchOpen: boolean
  setChatSearchOpen: Dispatch<SetStateAction<boolean>>
  chatSearchQuery: string
  setChatSearchQuery: Dispatch<SetStateAction<string>>
  moreMenuOpen: boolean
  setMoreMenuOpen: Dispatch<SetStateAction<boolean>>
  profileOverlayOpen: boolean
  setProfileOverlayOpen: Dispatch<SetStateAction<boolean>>
  settingsOverlayOpen: boolean
  setSettingsOverlayOpen: Dispatch<SetStateAction<boolean>>
  attachPopoverOpen: boolean
  setAttachPopoverOpen: Dispatch<SetStateAction<boolean>>
  toasts: Toast[]
  showToast: (message: string, tone?: string) => void
  sidebarTab: SidebarTab
  setSidebarTab: Dispatch<SetStateAction<SidebarTab>>
  chatSearchInputRef: RefObject<HTMLInputElement | null>
  chatFilterInputRef: RefObject<HTMLInputElement | null>
  directChatInputRef: RefObject<HTMLInputElement | null>
  groupTitleInputRef: RefObject<HTMLInputElement | null>
  draftInputRef: RefObject<HTMLTextAreaElement | null>
  chatButtonRefs: RefObject<Record<string, HTMLButtonElement | null>>
}

export const UIContext = createContext<UIContextValue | null>(null)

export function useUIContext(): UIContextValue {
  const value = useContext(UIContext)

  if (!value) {
    throw new Error('useUIContext must be used within a UIContext.Provider')
  }

  return value
}
