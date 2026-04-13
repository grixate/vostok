import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../lib/api.ts'

const { decryptMessageTextMock } = vi.hoisted(() => ({
  decryptMessageTextMock: vi.fn()
}))

vi.mock('../lib/message-vault.ts', () => ({
  decryptMessageText: decryptMessageTextMock
}))

function createIncomingMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    chat_id: 'chat-1',
    client_id: 'client-1',
    message_kind: 'text',
    crypto_scheme: 'signal-v1',
    sender_key_id: null,
    sender_key_epoch: null,
    sender_device_id: 'sender-device',
    sender_username: 'alice',
    inserted_at: new Date().toISOString(),
    pinned_at: null,
    edited_at: null,
    deleted_at: null,
    header: btoa(
      JSON.stringify({
        algorithm: 'signal-v1',
        type_map: {
          'receiver-device': 3
        }
      })
    ),
    ciphertext: btoa('ciphertext'),
    reply_to_message_id: null,
    recipient_device_ids: ['receiver-device'],
    reactions: [],
    recipient_envelope: btoa('recipient-envelope'),
    ...overrides
  }
}

describe('message-helpers decrypted plaintext cache', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => {
            storage.set(key, value)
          },
          removeItem: (key: string) => {
            storage.delete(key)
          },
          clear: () => {
            storage.clear()
          }
        }
      },
      configurable: true
    })

    vi.resetModules()
    decryptMessageTextMock.mockReset()
    window.localStorage.clear()
  })

  it('reuses persisted decrypted plaintext after a module reload', async () => {
    decryptMessageTextMock.mockResolvedValueOnce('hello from signal')

    const helpersFirst = await import('./message-helpers.ts')
    const message = createIncomingMessage()

    const firstProjection = await helpersFirst.projectMessage(
      message,
      'scope-chat-1',
      'receiver-device'
    )

    expect(firstProjection.decryptable).toBe(true)
    expect(firstProjection.text).toBe('hello from signal')
    expect(window.localStorage.getItem('vostok.decrypted-plaintext')).toContain(
      'hello from signal'
    )

    vi.resetModules()
    decryptMessageTextMock.mockReset()
    decryptMessageTextMock.mockRejectedValueOnce(
      new Error('Message key not found. The counter was repeated or the key was not filled.')
    )

    const helpersReloaded = await import('./message-helpers.ts')
    const reprojected = await helpersReloaded.projectMessage(
      message,
      'scope-chat-1',
      'receiver-device'
    )

    expect(reprojected.decryptable).toBe(true)
    expect(reprojected.text).toBe('hello from signal')
    expect(decryptMessageTextMock).not.toHaveBeenCalled()
  })

  it('preserves a newly confirmed message when a stale sync returns empty', async () => {
    const helpers = await import('./message-helpers.ts')

    const threadAtSyncStart = [] satisfies Awaited<ReturnType<typeof helpers.projectMessage>>[]
    const currentThread = [
      {
        id: 'message-1',
        clientId: 'client-1',
        text: 'hello',
        sentAt: '2026-04-09T10:00:01.000Z',
        side: 'outgoing' as const,
        decryptable: true
      }
    ]

    expect(
      helpers.mergeSyncedMessageThread(threadAtSyncStart, currentThread, [])
    ).toEqual(currentThread)
  })

  it('invalidates cached plaintext when edited_at changes and re-projects edited text', async () => {
    decryptMessageTextMock
      .mockResolvedValueOnce('original text')
      .mockResolvedValueOnce('edited text')

    const helpers = await import('./message-helpers.ts')
    const message = createIncomingMessage({ id: 'message-edited', client_id: 'client-edited' })

    const firstProjection = await helpers.projectMessage(
      message,
      'scope-chat-1',
      'receiver-device'
    )
    expect(firstProjection.text).toBe('original text')

    const editedAt = new Date().toISOString()
    const editedProjection = await helpers.projectMessage(
      {
        ...message,
        edited_at: editedAt
      },
      'scope-chat-1',
      'receiver-device'
    )

    expect(editedProjection.text).toBe('edited text')
    expect(editedProjection.editedAt).toBe(editedAt)
    expect(decryptMessageTextMock).toHaveBeenCalledTimes(2)
  })

  it('uses updated sent plaintext cache for edited outbound messages with same client_id', async () => {
    decryptMessageTextMock.mockRejectedValue(
      new Error('Message key not found. The counter was repeated or the key was not filled.')
    )

    const helpers = await import('./message-helpers.ts')
    const ownMessage = createIncomingMessage({
      id: 'outgoing-message',
      client_id: 'client-outgoing',
      sender_device_id: 'receiver-device',
      sender_username: 'me'
    })

    helpers.cacheSentPlaintext('client-outgoing', 'before edit', undefined, null)

    const beforeEditProjection = await helpers.projectMessage(
      ownMessage,
      'scope-chat-1',
      'receiver-device'
    )
    expect(beforeEditProjection.text).toBe('before edit')

    const editedAt = new Date(Date.now() + 60_000).toISOString()
    helpers.cacheSentPlaintext('client-outgoing', 'after edit', undefined, editedAt)

    const afterEditProjection = await helpers.projectMessage(
      {
        ...ownMessage,
        edited_at: editedAt
      },
      'scope-chat-1',
      'receiver-device'
    )

    expect(afterEditProjection.text).toBe('after edit')
    expect(afterEditProjection.editedAt).toBe(editedAt)
    expect(afterEditProjection.decryptable).toBe(true)
  })

  it('does not log an error when decryption runs before Signal store bootstrap', async () => {
    decryptMessageTextMock.mockRejectedValue(
      new Error('Signal store not initialized. Call initSignalStore() first.')
    )

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const helpers = await import('./message-helpers.ts')

    const projection = await helpers.projectMessage(
      createIncomingMessage({ id: 'message-bootstrap-race', client_id: 'client-bootstrap-race' }),
      'scope-chat-1',
      'receiver-device'
    )

    expect(projection.decryptable).toBe(false)
    expect(projection.text).toBe('[Encrypted envelope available but not decryptable on this device]')
    expect(consoleErrorSpy).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('does not log repeated errors for expected missing session decrypt misses', async () => {
    decryptMessageTextMock.mockRejectedValue(
      new Error('No record for device 089da78f-321c-4afd-82e2-294d50da2537.1')
    )

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const helpers = await import('./message-helpers.ts')
    const message = createIncomingMessage({ id: 'message-missing-session', client_id: 'client-missing-session' })

    await helpers.projectMessage(message, 'scope-chat-1', 'receiver-device')
    await helpers.projectMessage(message, 'scope-chat-1', 'receiver-device')

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(consoleDebugSpy).toHaveBeenCalledTimes(1)

    consoleErrorSpy.mockRestore()
    consoleDebugSpy.mockRestore()
  })
})
