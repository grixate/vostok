export type NotificationPayload = {
  title: string
  body: string
  chatId: string
  icon?: string
}

let permissionGranted: boolean | null = null

/**
 * Request notification permission on first call.
 * Returns true if notifications are permitted, false otherwise.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    permissionGranted = false
    return false
  }

  if (Notification.permission === 'granted') {
    permissionGranted = true
    return true
  }

  if (Notification.permission === 'denied') {
    permissionGranted = false
    return false
  }

  try {
    const result = await Notification.requestPermission()
    permissionGranted = result === 'granted'
    return permissionGranted
  } catch {
    permissionGranted = false
    return false
  }
}

/**
 * Send a desktop notification.
 *
 * Uses the browser Notification API as a baseline.
 * Future: check for Tauri and use @tauri-apps/plugin-notification when available.
 */
export async function sendNotification(payload: NotificationPayload): Promise<void> {
  // Ensure permission is available
  if (permissionGranted === null) {
    await requestNotificationPermission()
  }

  if (!permissionGranted) {
    return
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(payload.title, {
      body: payload.body,
      tag: payload.chatId, // Prevent duplicate notifications for same chat
      icon: payload.icon
    })

    notification.onclick = () => {
      window.focus()
      // Dispatch a custom event for the app to handle navigation
      window.dispatchEvent(
        new CustomEvent('vostok:navigate-chat', {
          detail: { chatId: payload.chatId }
        })
      )
    }
  }
}

/**
 * Check if the window is currently focused.
 */
export function isWindowFocused(): boolean {
  return document.hasFocus()
}

/**
 * Check whether notification permission has been granted.
 * Returns null if permission has not been requested yet.
 */
export function getNotificationPermissionStatus(): boolean | null {
  return permissionGranted
}
