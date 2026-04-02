import { Presence, Socket, type Channel } from 'phoenix'
import type { ConnectionStatus } from './realtime.ts'

type RealtimeTestWindow = Window & {
  __VOSTOK_TEST_DISABLE_REALTIME__?: boolean
}

type UserActivityHandler = {
  onChatActivity: (chatId: string) => void
}

type PresenceHandler = {
  onSync: (onlineUserIds: Set<string>) => void
}

function toSocketUrl(baseUrl: string): string {
  const normalized = new URL(baseUrl)
  normalized.protocol = normalized.protocol === 'https:' ? 'wss:' : 'ws:'
  normalized.pathname = '/socket/device'
  normalized.search = ''
  normalized.hash = ''
  return normalized.toString()
}

function teardownChannel(channel: Channel, events: string[]) {
  for (const event of events) {
    channel.off(event)
  }

  void channel.leave()
}

function isRealtimeDisabledForTests(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return Boolean((window as RealtimeTestWindow).__VOSTOK_TEST_DISABLE_REALTIME__)
}

export type ServerRealtimeClient = {
  connect: (token: string) => void
  disconnect: () => void
  connectionStatus: () => ConnectionStatus
  subscribeToUserStream: (userId: string, handlers: UserActivityHandler) => () => void
  subscribeToPresence: (handlers: PresenceHandler) => () => void
}

export function createServerRealtimeClient(baseUrl: string): ServerRealtimeClient {
  let socket: Socket | null = null
  let socketToken: string | null = null
  let status: ConnectionStatus = 'disconnected'

  function ensureSocket(token: string): Socket {
    if (socket && socketToken === token) {
      return socket
    }

    if (socket) {
      socket.disconnect()
    }

    status = 'connecting'
    socketToken = token
    socket = new Socket(toSocketUrl(baseUrl), {
      params: { token },
      reconnectAfterMs: (tries) => Math.min(1000 * Math.pow(2, tries), 30000),
      heartbeatIntervalMs: 20000
    })

    socket.onOpen(() => {
      if (socketToken === token) {
        status = 'connected'
      }
    })
    socket.onClose(() => {
      if (socketToken === token) {
        status = 'disconnected'
      }
    })
    socket.onError(() => {
      if (socketToken === token) {
        status = 'error'
      }
    })
    socket.connect()

    return socket
  }

  return {
    connect(token) {
      if (isRealtimeDisabledForTests()) {
        status = 'connected'
        return
      }

      ensureSocket(token)
    },

    disconnect() {
      if (socket) {
        socket.disconnect()
      }
      socket = null
      socketToken = null
      status = 'disconnected'
    },

    connectionStatus() {
      return status
    },

    subscribeToUserStream(userId, handlers) {
      if (isRealtimeDisabledForTests()) {
        return () => {}
      }

      if (!socket || !socketToken) {
        return () => {}
      }

      const channel = socket.channel(`user:${userId}`)

      channel.on('chat:activity', (payload: unknown) => {
        if (payload && typeof payload === 'object') {
          const chatId = (payload as { chat_id?: unknown }).chat_id
          if (typeof chatId === 'string') {
            handlers.onChatActivity(chatId)
          }
        }
      })

      channel.join()

      return () => {
        teardownChannel(channel, ['chat:activity'])
      }
    },

    subscribeToPresence(handlers) {
      if (isRealtimeDisabledForTests()) {
        handlers.onSync(new Set())
        return () => {}
      }

      if (!socket || !socketToken) {
        return () => {}
      }

      const channel = socket.channel('presence:lobby')
      const presence = new Presence(channel)

      presence.onSync(() => {
        const state = presence.list((userId) => userId)
        handlers.onSync(new Set(state))
      })

      channel.join()

      return () => {
        teardownChannel(channel, [])
      }
    }
  }
}
