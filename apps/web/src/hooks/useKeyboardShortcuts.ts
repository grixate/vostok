import { useEffect, useEffectEvent } from 'react'
import { isEditableTarget } from '../utils/desktop-helpers.ts'
import { isDesktopShell } from '../lib/desktop-shell.ts'
import { useAppContext } from '../contexts/AppContext.tsx'
import { useThemeContext } from '../contexts/ThemeContext.tsx'
import { useUIContext } from '../contexts/UIContext.tsx'
import type { useAuth } from './useAuth.ts'
import type { useChatList } from './useChatList.ts'
import type { useDesktop } from './useDesktop.ts'
import type { useViewportLayout } from './useViewportLayout.ts'
import type { useMessages } from './useMessages.ts'
import type { useCall } from './useCall.ts'
import type { ChatSummary } from '../lib/api.ts'

type UseKeyboardShortcutsParams = {
  auth: ReturnType<typeof useAuth>
  chatList: ReturnType<typeof useChatList>
  activeChat: ChatSummary | null
  layout: ReturnType<typeof useViewportLayout>
  desktop: ReturnType<typeof useDesktop>
  messages: ReturnType<typeof useMessages>
  call: ReturnType<typeof useCall>
  desktopWindowTitle: string
}

export function useKeyboardShortcuts({
  auth,
  chatList,
  activeChat,
  layout,
  desktop,
  messages,
  call,
  desktopWindowTitle
}: UseKeyboardShortcutsParams) {
  const { loading: appContextValue_loading, setBanner } = useAppContext()
  const { themePreference, setThemePreference } = useThemeContext()
  const {
    draftInputRef,
    chatFilterInputRef,
    directChatInputRef,
    groupTitleInputRef,
    chatButtonRefs,
    chatSearchInputRef,
    setChatSearchOpen
  } = useUIContext()

  function focusRelativeChat(offset: number) {
    const navigableChats = chatList.visibleChatItems

    if (navigableChats.length === 0) {
      return
    }

    const currentIndex = activeChat
      ? navigableChats.findIndex((chat) => chat.id === activeChat.id)
      : 0
    const safeIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = (safeIndex + offset + navigableChats.length) % navigableChats.length
    const nextChat = navigableChats[nextIndex]

    chatList.setActiveChatId(nextChat.id)

    window.requestAnimationFrame(() => {
      chatButtonRefs.current[nextChat.id]?.focus()
    })
  }

  const handleDesktopShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (auth.view !== 'chat') {
      return
    }

    const hasModifier = event.metaKey || event.ctrlKey
    const typingTarget = isEditableTarget(event.target)

    if (event.key === 'Escape') {
      setBanner(null)

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }

      return
    }

    if (!typingTarget && !hasModifier && event.key === '/' && activeChat) {
      event.preventDefault()
      draftInputRef.current?.focus()
      return
    }

    if (!typingTarget && !hasModifier && event.altKey) {
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusRelativeChat(-1)
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusRelativeChat(1)
        return
      }
    }

    if (!hasModifier) {
      return
    }

    if ((event.key === '\\' || event.code === 'Backslash') && !event.shiftKey) {
      event.preventDefault()
      layout.setDetailRailPreferred((current) => !current)
      return
    }

    if (isDesktopShell() && event.shiftKey) {
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault()
        void desktop.handleMinimizeDesktopHostWindow()
        return
      }

      if (event.code === 'Digit0') {
        event.preventDefault()
        void desktop.handleResetDesktopHostWindowFrame()
        return
      }

      if (event.key.toLowerCase() === 'p') {
        event.preventDefault()
        void desktop.handleToggleDesktopAlwaysOnTop()
        return
      }

      if (event.key.toLowerCase() === 'u') {
        event.preventDefault()
        void desktop.handleToggleDesktopFullscreen()
        return
      }

      if (event.key.toLowerCase() === 'd') {
        event.preventDefault()
        void desktop.handleCopyDesktopDiagnostics({
          capturedAt: new Date().toISOString(),
          desktopShell: desktop.desktopShell,
          desktopRuntime: desktop.desktopRuntime,
          windowState: {
            maximized: desktop.desktopWindowMaximized,
            focused: desktop.desktopWindowFocused,
            alwaysOnTop: desktop.desktopWindowAlwaysOnTop,
            fullscreen: desktop.desktopWindowFullscreen
          },
          windowGeometry: desktop.desktopWindowGeometry,
          nativeTitle: desktopWindowTitle,
          layout: {
            detailRailPreferred: layout.detailRailPreferred,
            detailRailVisible: layout.detailRailVisible,
            isDesktopWide: layout.isDesktopWide
          },
          activeContext: {
            activeChatId: activeChat?.id ?? null,
            activeChatTitle: activeChat?.title ?? null,
            activeCallId: call.activeCall?.id ?? null,
            activeCallMode: call.activeCall?.mode ?? null
          }
        })
        return
      }

      if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        void desktop.handleCloseDesktopHostWindow()
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        void desktop.handleToggleDesktopWindowMaximize()
        return
      }
    }

    if (event.key.toLowerCase() === 'f' && event.shiftKey) {
      event.preventDefault()
      chatFilterInputRef.current?.focus()
      chatFilterInputRef.current?.select()
      return
    }

    if (event.key.toLowerCase() === 'f' && !event.shiftKey) {
      event.preventDefault()
      setChatSearchOpen((v) => {
        if (!v) {
          window.requestAnimationFrame(() => {
            chatSearchInputRef.current?.focus()
          })
        }
        return !v
      })
      return
    }

    if (event.key.toLowerCase() === 'n' && !event.shiftKey) {
      event.preventDefault()
      chatList.setNewMessageMode((v) => !v)
      return
    }

    if (event.key.toLowerCase() === 'd' && event.shiftKey) {
      event.preventDefault()
      const cycle: Record<string, 'light' | 'dark' | 'system'> = { light: 'dark', dark: 'system', system: 'light' }
      setThemePreference(cycle[themePreference] ?? 'system')
      return
    }

    if (event.key.toLowerCase() === 'k' && !event.shiftKey) {
      event.preventDefault()
      directChatInputRef.current?.focus()
      directChatInputRef.current?.select()
      return
    }

    if (event.key.toLowerCase() === 'g' && event.shiftKey) {
      event.preventDefault()
      groupTitleInputRef.current?.focus()
      groupTitleInputRef.current?.select()
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      if (messages.draft.trim() !== '' && activeChat && !appContextValue_loading) {
        event.preventDefault()
        void messages.sendDraftMessage(chatList.activeChatId)
      }

      return
    }

    if (event.shiftKey && !appContextValue_loading && activeChat && !call.activeCall) {
      if (event.key.toLowerCase() === 'a') {
        event.preventDefault()
        void call.handleStartCall('voice')
        return
      }

      if (event.key.toLowerCase() === 'v') {
        event.preventDefault()
        void call.handleStartCall('video')
      }
    }
  })

  useEffect(() => {
    window.addEventListener('keydown', handleDesktopShortcut)

    return () => {
      window.removeEventListener('keydown', handleDesktopShortcut)
    }
  }, [])
}
