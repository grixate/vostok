export type CachedAttachment = {
  uploadId: string
  fileName: string
  contentType: string
  size: number
  contentKeyBase64?: string
  ivBase64?: string
}

export type CachedMessage = {
  id: string
  clientId?: string
  text: string
  sentAt: string
  side: 'incoming' | 'outgoing' | 'system'
  decryptable: boolean
  attachment?: CachedAttachment
  reactions?: Array<{
    reactionKey: string
    count: number
    reacted: boolean
  }>
}

const CACHE_PREFIX = 'vostok.chat-cache.'

export function readCachedMessages(chatId: string): CachedMessage[] {
  const raw = window.localStorage.getItem(`${CACHE_PREFIX}${chatId}`)

  if (!raw) {
    return []
  }

  try {
    return JSON.parse(raw) as CachedMessage[]
  } catch {
    window.localStorage.removeItem(`${CACHE_PREFIX}${chatId}`)
    return []
  }
}

export function writeCachedMessages(chatId: string, messages: CachedMessage[]) {
  window.localStorage.setItem(`${CACHE_PREFIX}${chatId}`, JSON.stringify(messages))
}
