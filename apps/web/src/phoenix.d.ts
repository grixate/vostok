declare module 'phoenix' {
  export class Push {
    receive(status: 'ok' | 'error' | 'timeout', callback: (payload?: unknown) => void): Push
  }

  export class Channel {
    readonly socket: Socket
    on(event: string, callback: (payload: unknown) => void): number
    off(event: string, ref?: number): void
    join(timeout?: number): Push
    leave(timeout?: number): Push
    push(event: string, payload?: Record<string, unknown>, timeout?: number): Push
  }

  export class Socket {
    constructor(
      endPoint: string,
      opts?: {
        params?: Record<string, string>
        reconnectAfterMs?: (tries: number) => number
        rejoinAfterMs?: (tries: number) => number
        heartbeatIntervalMs?: number
      }
    )

    channel(topic: string, chanParams?: Record<string, unknown>): Channel
    connect(): void
    disconnect(callback?: () => void, code?: number, reason?: string): void
    onOpen(callback: () => void): number
    onClose(callback: () => void): number
    onError(callback: (error: unknown) => void): number
  }

  export class Presence {
    constructor(channel: Channel)
    onSync(callback: () => void): void
    list<T>(chooser: (key: string, presence: unknown) => T): T[]
  }
}
