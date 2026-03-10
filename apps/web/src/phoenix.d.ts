declare module 'phoenix' {
  export class Push {
    receive(status: 'ok' | 'error' | 'timeout', callback: () => void): Push
  }

  export class Channel {
    on(event: string, callback: (payload: unknown) => void): number
    off(event: string, ref?: number): void
    join(timeout?: number): Push
    leave(timeout?: number): Push
  }

  export class Socket {
    constructor(
      endPoint: string,
      opts?: {
        params?: Record<string, string>
      }
    )

    channel(topic: string, chanParams?: Record<string, unknown>): Channel
    connect(): void
    disconnect(callback?: () => void, code?: number, reason?: string): void
    onOpen(callback: () => void): string
    onClose(callback: () => void): string
    onError(callback: (reason?: string) => void): string
  }
}
