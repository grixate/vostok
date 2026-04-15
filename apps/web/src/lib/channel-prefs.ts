// Per-channel client preferences stored in localStorage.
// Currently tracks whether the viewer wants desktop notifications
// for new comments on channel posts (opt-in, off by default).

const COMMENTS_NOTIFY_PREFIX = 'vostok.channel-prefs.comments-notify.'

export function getChannelCommentsNotify(chatId: string): boolean {
  try {
    return window.localStorage.getItem(`${COMMENTS_NOTIFY_PREFIX}${chatId}`) === '1'
  } catch {
    return false
  }
}

export function setChannelCommentsNotify(chatId: string, value: boolean): void {
  try {
    window.localStorage.setItem(`${COMMENTS_NOTIFY_PREFIX}${chatId}`, value ? '1' : '0')
  } catch {
    // Storage unavailable — no-op.
  }
}
