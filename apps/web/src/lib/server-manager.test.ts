import { describe, expect, it } from 'vitest'

import {
  findPreferredServer,
  findPrimaryServer,
  mergeServerChats,
  serverForChat,
  updateServer
} from './server-manager.ts'
import type { ServerEntry } from './multi-server.ts'
import type { ChatSummary } from './api.ts'

function makeServer(overrides: Partial<ServerEntry>): ServerEntry {
  return {
    id: 'srv_default',
    label: 'Default',
    url: 'https://default.example.com',
    color: '#008BFF',
    auth: null,
    device: null,
    serverInfo: null,
    lastConnectedAt: null,
    sortOrder: 0,
    enabled: true,
    ...overrides
  }
}

function makeChat(overrides: Partial<ChatSummary>): ChatSummary {
  return {
    id: 'chat-1',
    type: 'direct',
    title: 'Inbox',
    participant_usernames: ['ada'],
    participant_user_ids: ['user-1'],
    is_self_chat: false,
    latest_message_at: '2026-04-01T10:00:00Z',
    message_count: 1,
    ...overrides
  }
}

describe('server-manager helpers', () => {
  it('finds the primary authenticated server first', () => {
    const unauthenticated = makeServer({ id: 'srv_a', sortOrder: 0 })
    const authenticated = makeServer({
      id: 'srv_b',
      sortOrder: 1,
      auth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        user: {
          id: 'user-2',
          username: 'ada',
          display_name: 'Ada',
          role: 'member',
          temp_password: false
        }
      }
    })

    expect(findPrimaryServer([unauthenticated, authenticated])?.id).toBe('srv_b')
  })

  it('falls back to the first enabled server when nothing is authenticated', () => {
    const first = makeServer({ id: 'srv_a', sortOrder: 0, enabled: true })
    const second = makeServer({ id: 'srv_b', sortOrder: 1, enabled: true })

    expect(findPreferredServer([second, first])?.id).toBe('srv_a')
  })

  it('merges chats only from enabled authenticated servers and qualifies ids', () => {
    const connected = makeServer({
      id: 'srv_live',
      label: 'Live',
      auth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        user: {
          id: 'user-2',
          username: 'ada',
          display_name: 'Ada',
          role: 'member',
          temp_password: false
        }
      }
    })
    const disabled = makeServer({ id: 'srv_disabled', enabled: false })

    const chatsByServerId = new Map<string, ChatSummary[]>([
      ['srv_live', [makeChat({ id: 'chat-9', title: 'Live Chat' })]],
      ['srv_disabled', [makeChat({ id: 'chat-2', title: 'Should Not Show' })]]
    ])

    expect(mergeServerChats([connected, disabled], chatsByServerId)).toEqual([
      expect.objectContaining({
        id: 'srv_live::chat-9',
        rawId: 'chat-9',
        serverLabel: 'Live'
      })
    ])
  })

  it('resolves a qualified chat id back to its owning server', () => {
    const servers = [
      makeServer({ id: 'srv_a', url: 'https://alpha.example.com' }),
      makeServer({ id: 'srv_b', url: 'https://beta.example.com' })
    ]

    expect(serverForChat(servers, 'srv_b::chat-123')?.url).toBe('https://beta.example.com')
    expect(serverForChat(servers, 'chat-123')).toBeNull()
  })

  it('updates only the targeted server record', () => {
    const servers = [
      makeServer({ id: 'srv_a', label: 'Alpha' }),
      makeServer({ id: 'srv_b', label: 'Beta' })
    ]

    expect(updateServer(servers, 'srv_b', { label: 'Gamma' }).map((server) => server.label)).toEqual([
      'Alpha',
      'Gamma'
    ])
  })
})
