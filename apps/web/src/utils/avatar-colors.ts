/**
 * Telegram-style 8-color peer avatar ring.
 * Maps a username/title to one of the 8 CSS custom-property peer colors.
 */

const PEER_COLORS = [
  'var(--peer-1)',
  'var(--peer-2)',
  'var(--peer-3)',
  'var(--peer-4)',
  'var(--peer-5)',
  'var(--peer-6)',
  'var(--peer-7)',
  'var(--peer-8)',
]

export function peerColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length]
}

/** Returns accent for self-chat, otherwise a peer color derived from title. */
export function chatAvatarColor(title: string, isSelfChat: boolean): string {
  return isSelfChat ? 'var(--accent)' : peerColor(title)
}
