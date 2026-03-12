export type DeepLink =
  | { type: 'chat'; chatId: string }
  | { type: 'settings' }
  | { type: 'link'; code: string }
  | null

/**
 * Parse a deep link from a URL string.
 *
 * Supported formats:
 *   vostok://chat/<chatId>
 *   vostok://settings
 *   vostok://link/<code>
 *
 * Web fallback (query parameters):
 *   ?chat=<chatId>
 *   ?settings
 *   ?link=<code>
 */
export function parseDeepLink(url: string): DeepLink {
  try {
    // Try parsing as vostok:// protocol
    if (url.startsWith('vostok://')) {
      const path = url.slice('vostok://'.length)
      const segments = path.split('/').filter(Boolean)

      if (segments[0] === 'chat' && segments[1]) {
        return { type: 'chat', chatId: segments[1] }
      }

      if (segments[0] === 'settings') {
        return { type: 'settings' }
      }

      if (segments[0] === 'link' && segments[1]) {
        return { type: 'link', code: segments[1] }
      }

      return null
    }

    // Try parsing as standard URL with query parameters (web fallback)
    const parsed = new URL(url, window.location.origin)
    const chatId = parsed.searchParams.get('chat')
    const linkCode = parsed.searchParams.get('link')

    if (chatId) {
      return { type: 'chat', chatId }
    }

    if (parsed.searchParams.has('settings')) {
      return { type: 'settings' }
    }

    if (linkCode) {
      return { type: 'link', code: linkCode }
    }
  } catch {
    // Invalid URL, return null
  }

  return null
}

/**
 * Set up a listener for deep link events.
 *
 * Listens for:
 * - `vostok:navigate-chat` custom events (dispatched by notification clicks)
 * - `vostok:deep-link` custom events (dispatched by Tauri deep link plugin, future)
 * - `popstate` events for URL-based navigation
 *
 * Returns a cleanup function to remove all listeners.
 */
export function setupDeepLinkListener(callback: (link: DeepLink) => void): () => void {
  // Handle navigate-chat events from notification clicks
  function handleNavigateChat(event: Event) {
    const detail = (event as CustomEvent<{ chatId?: string }>).detail

    if (detail?.chatId) {
      callback({ type: 'chat', chatId: detail.chatId })
    }
  }

  // Handle deep-link events from Tauri (future)
  function handleDeepLink(event: Event) {
    const detail = (event as CustomEvent<{ url?: string }>).detail

    if (detail?.url) {
      const parsed = parseDeepLink(detail.url)

      if (parsed) {
        callback(parsed)
      }
    }
  }

  // Handle browser popstate for URL-based deep links
  function handlePopState() {
    const parsed = parseDeepLink(window.location.href)

    if (parsed) {
      callback(parsed)
    }
  }

  window.addEventListener('vostok:navigate-chat', handleNavigateChat)
  window.addEventListener('vostok:deep-link', handleDeepLink)
  window.addEventListener('popstate', handlePopState)

  return () => {
    window.removeEventListener('vostok:navigate-chat', handleNavigateChat)
    window.removeEventListener('vostok:deep-link', handleDeepLink)
    window.removeEventListener('popstate', handlePopState)
  }
}
