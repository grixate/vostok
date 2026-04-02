import { describe, expect, it } from 'vitest'

import {
  doesAuthSessionMatchServer,
  findServerForAuthSession,
  shouldShowOnboarding
} from './auth-routing.ts'
import type { ServerEntry } from './multi-server.ts'

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

describe('auth-routing helpers', () => {
  it('matches auth sessions to the active server by normalized url', () => {
    expect(doesAuthSessionMatchServer('https://alpha.example.com/', 'https://alpha.example.com')).toBe(true)
    expect(doesAuthSessionMatchServer('https://alpha.example.com', 'https://beta.example.com')).toBe(false)
    expect(doesAuthSessionMatchServer('https://alpha.example.com', null)).toBe(true)
  })

  it('finds the server entry that owns a scoped auth session', () => {
    const servers = [
      makeServer({ id: 'srv_a', url: 'https://alpha.example.com/' }),
      makeServer({ id: 'srv_b', url: 'https://beta.example.com' })
    ]

    expect(findServerForAuthSession(servers, 'https://alpha.example.com')?.id).toBe('srv_a')
    expect(findServerForAuthSession(servers, 'https://missing.example.com')).toBeNull()
    expect(findServerForAuthSession(servers, null)).toBeNull()
  })

  it('shows onboarding only when there is no usable authenticated server context', () => {
    expect(shouldShowOnboarding(false, false, false)).toBe(true)
    expect(shouldShowOnboarding(false, true, true)).toBe(false)
    expect(shouldShowOnboarding(true, false, false)).toBe(false)
    expect(shouldShowOnboarding(false, true, false)).toBe(true)
  })
})
