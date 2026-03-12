import { useEffect } from 'react'
import { parseDeepLink, setupDeepLinkListener } from '../lib/deep-links.ts'

type DeepLinkActions = {
  setActiveChatId: (chatId: string) => void
  setSettingsOverlayOpen: (open: boolean) => void
}

/**
 * Deep link hook that handles navigation from:
 * - URL query parameters on initial load
 * - Notification clicks (vostok:navigate-chat events)
 * - Tauri deep link events (future, via vostok:deep-link events)
 * - Browser popstate events
 *
 * On deep link:
 * - chat: navigate to the specified chat
 * - settings: open the settings overlay
 * - link: reserved for future invite link handling
 */
export function useDeepLinks(
  authenticated: boolean,
  actions: DeepLinkActions
) {
  // Parse initial URL on mount (after auth)
  useEffect(() => {
    if (!authenticated) {
      return
    }

    const initialLink = parseDeepLink(window.location.href)

    if (initialLink) {
      handleDeepLinkAction(initialLink, actions)

      // Clean up the URL query params after handling (don't leave ?chat=xxx in the address bar)
      if (window.location.search) {
        const cleanUrl = window.location.pathname + window.location.hash
        window.history.replaceState(null, '', cleanUrl)
      }
    }
  }, [authenticated])

  // Listen for deep link events (notification clicks, Tauri deep links, popstate)
  useEffect(() => {
    if (!authenticated) {
      return
    }

    return setupDeepLinkListener((link) => {
      if (link) {
        handleDeepLinkAction(link, actions)
      }
    })
  }, [authenticated])
}

function handleDeepLinkAction(
  link: NonNullable<ReturnType<typeof parseDeepLink>>,
  actions: DeepLinkActions
) {
  switch (link.type) {
    case 'chat':
      actions.setActiveChatId(link.chatId)
      break
    case 'settings':
      actions.setSettingsOverlayOpen(true)
      break
    case 'link':
      // Reserved for future invite link handling.
      // For now, log the code for debugging.
      console.info('[deep-links] Received link code:', link.code)
      break
  }
}
