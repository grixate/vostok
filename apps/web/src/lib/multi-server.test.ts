import { describe, expect, it } from 'vitest'

import {
  defaultServerLabel,
  getRawChatId,
  getServerIdFromQualifiedChatId,
  normalizeServerUrl,
  qualifyChatId,
  sortMergedChats,
  toMergedChatSummary,
  type ServerEntry
} from './multi-server.ts'
import type { ChatSummary } from './api.ts'

const baseServer: ServerEntry = {
  id: 'srv_alpha',
  label: 'Alpha',
  url: 'https://alpha.example.com',
  color: '#008BFF',
  auth: null,
  device: null,
  serverInfo: null,
  lastConnectedAt: null,
  sortOrder: 0,
  enabled: true
}

const baseChat: ChatSummary = {
  id: 'chat-1',
  type: 'direct',
  title: 'Nina',
  participant_usernames: ['nina'],
  participant_user_ids: ['user-1'],
  is_self_chat: false,
  latest_message_at: '2026-04-01T10:00:00Z',
  message_count: 3
}

describe('multi-server helpers', () => {
  it('qualifies and parses chat ids consistently', () => {
    const qualified = qualifyChatId('srv_alpha', 'chat-1')

    expect(qualified).toBe('srv_alpha::chat-1')
    expect(getServerIdFromQualifiedChatId(qualified)).toBe('srv_alpha')
    expect(getRawChatId(qualified)).toBe('chat-1')
    expect(getRawChatId('chat-1')).toBe('chat-1')
    expect(getServerIdFromQualifiedChatId('chat-1')).toBeNull()
  })

  it('normalizes server urls and strips extra path slashes', () => {
    expect(normalizeServerUrl('https://alpha.example.com///')).toBe('https://alpha.example.com')
    expect(normalizeServerUrl('https://alpha.example.com/app///')).toBe('https://alpha.example.com/app')
    expect(normalizeServerUrl(' https://alpha.example.com/app/ ')).toBe('https://alpha.example.com/app')
  })

  it('converts raw chat summaries into merged server-scoped chat summaries', () => {
    expect(toMergedChatSummary(baseServer, baseChat)).toEqual({
      ...baseChat,
      id: 'srv_alpha::chat-1',
      rawId: 'chat-1',
      qualifiedId: 'srv_alpha::chat-1',
      serverId: 'srv_alpha',
      serverLabel: 'Alpha',
      serverColor: '#008BFF',
      serverUrl: 'https://alpha.example.com'
    })
  })

  it('sorts merged chats by latest activity descending', () => {
    const newest = toMergedChatSummary(baseServer, {
      ...baseChat,
      id: 'chat-new',
      latest_message_at: '2026-04-01T12:00:00Z'
    })
    const oldest = toMergedChatSummary(baseServer, {
      ...baseChat,
      id: 'chat-old',
      latest_message_at: '2026-04-01T08:00:00Z'
    })

    expect(sortMergedChats([oldest, newest]).map((chat) => chat.rawId)).toEqual([
      'chat-new',
      'chat-old'
    ])
  })

  it('provides a stable fallback label when server metadata is empty', () => {
    expect(defaultServerLabel('Alpha Relay')).toBe('Alpha Relay')
    expect(defaultServerLabel('')).toBe('My Server')
    expect(defaultServerLabel(undefined)).toBe('My Server')
  })
})
