import { beforeEach, describe, expect, it, vi } from 'vitest'

const { signalDecryptMock } = vi.hoisted(() => ({
  signalDecryptMock: vi.fn()
}))

vi.mock('./secure-kv-store', () => ({
  whenSecureStoreReady: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./signal-bridge', () => ({
  decryptMessage: signalDecryptMock
}))

import { decryptMessageText } from './message-vault.ts'
import type { ChatMessage } from './api.ts'

function createSignalMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    chat_id: 'chat-1',
    client_id: 'client-1',
    message_kind: 'text',
    crypto_scheme: 'signal-v2',
    sender_device_id: 'sender-device',
    sender_username: 'alice',
    inserted_at: new Date().toISOString(),
    pinned_at: null,
    edited_at: null,
    deleted_at: null,
    header: null,
    ciphertext: btoa('ciphertext'),
    reply_to_message_id: null,
    recipient_device_ids: [],
    reactions: [],
    recipient_envelope: btoa('recipient-envelope'),
    ...overrides
  }
}

describe('message-vault signal decrypt', () => {
  beforeEach(() => {
    signalDecryptMock.mockReset()
    signalDecryptMock.mockResolvedValue('hello')
  })

  it('does not guess a device-specific envelope type from another device entry', async () => {
    const header = btoa(
      JSON.stringify({
        algorithm: 'signal-v2',
        type_map: {
          'other-device': 1
        }
      })
    )

    await expect(
      decryptMessageText(createSignalMessage({ header }), 'current-device', 'server-1')
    ).rejects.toThrow(
      'Signal message type_map is missing an entry for current device current-device.'
    )

    expect(signalDecryptMock).not.toHaveBeenCalled()
  })

  it('requires a current device id for signal message decryption', async () => {
    await expect(
      decryptMessageText(createSignalMessage(), '', 'server-1')
    ).rejects.toThrow('Signal message decryption requires the current device id.')

    expect(signalDecryptMock).not.toHaveBeenCalled()
  })
})
