import type { ChatSummary } from './api.ts'
import type { AuthSession, ServerInfo, StoredDevice } from '../types.ts'
import {
  AUTH_STORAGE_KEY,
  DEFAULT_MULTI_SERVER_COLOR,
  SERVERS_ACTIVE_STORAGE_KEY,
  SERVERS_STORAGE_KEY,
  STORAGE_KEY
} from '../constants.ts'
import { defaultServerLabel, normalizeServerUrl, sortMergedChats, toMergedChatSummary, type MergedChatSummary, type ServerEntry } from './multi-server.ts'

const DEFAULT_SERVER_ID_PREFIX = 'srv'

function readLocalStorageValue(key: string): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocalStorageValue(key: string, value: string | null) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (value == null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, value)
    }
  } catch {
    // Ignore storage errors.
  }
}

function createServerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${DEFAULT_SERVER_ID_PREFIX}_${crypto.randomUUID()}`
  }

  return `${DEFAULT_SERVER_ID_PREFIX}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function readActiveServerId(): string | null {
  return readLocalStorageValue(SERVERS_ACTIVE_STORAGE_KEY)
}

export function persistActiveServerId(serverId: string | null) {
  writeLocalStorageValue(SERVERS_ACTIVE_STORAGE_KEY, serverId)
}

export function loadServers(): ServerEntry[] {
  const stored = parseJson<ServerEntry[]>(readLocalStorageValue(SERVERS_STORAGE_KEY))

  if (Array.isArray(stored) && stored.length > 0) {
    return stored
      .map((entry, index) => normalizeServerEntry(entry, index))
      .sort((left, right) => left.sortOrder - right.sortOrder)
  }

  const migrated = migrateLegacySingleServer()

  if (migrated.length > 0) {
    saveServers(migrated)
  }

  return migrated
}

export function saveServers(servers: ServerEntry[]): void {
  const normalized = servers
    .map((entry, index) => normalizeServerEntry(entry, index))
    .sort((left, right) => left.sortOrder - right.sortOrder)

  writeLocalStorageValue(SERVERS_STORAGE_KEY, JSON.stringify(normalized))
}

export function addServer(url: string, label: string, color: string): ServerEntry {
  return normalizeServerEntry({
    id: createServerId(),
    url,
    label,
    color,
    auth: null,
    device: null,
    serverInfo: null,
    lastConnectedAt: null,
    sortOrder: 0,
    enabled: true
  }, 0)
}

export function updateServer(servers: ServerEntry[], serverId: string, updates: Partial<ServerEntry>): ServerEntry[] {
  let changed = false

  const nextServers = servers.map((server, index) => {
    if (server.id !== serverId) {
      return server
    }

    const nextServer = normalizeServerEntry({ ...server, ...updates }, index)
    if (JSON.stringify(server) === JSON.stringify(nextServer)) {
      return server
    }

    changed = true
    return nextServer
  })

  return changed ? nextServers : servers
}

export function removeServer(servers: ServerEntry[], serverId: string): ServerEntry[] {
  return servers
    .filter((server) => server.id !== serverId)
    .map((server, index) => ({ ...server, sortOrder: index }))
}

export function mergeServerChats(servers: ServerEntry[], chatsByServerId: Map<string, ChatSummary[]>): MergedChatSummary[] {
  const merged: MergedChatSummary[] = []

  for (const server of [...servers].sort((left, right) => left.sortOrder - right.sortOrder)) {
    if (!server.enabled || !server.auth) {
      continue
    }

    const chats = chatsByServerId.get(server.id) ?? []
    for (const chat of chats) {
      merged.push(toMergedChatSummary(server, chat))
    }
  }

  return sortMergedChats(merged)
}

export function serverForChat(servers: ServerEntry[], qualifiedChatId: string | null | undefined): ServerEntry | null {
  if (!qualifiedChatId || !qualifiedChatId.includes('::')) {
    return null
  }

  const [serverId] = qualifiedChatId.split('::', 1)
  return servers.find((server) => server.id === serverId) ?? null
}

export function findPrimaryServer(servers: ServerEntry[]): ServerEntry | null {
  return [...servers]
    .filter((server) => server.enabled && server.auth)
    .sort((left, right) => left.sortOrder - right.sortOrder)[0] ?? null
}

export function findPreferredServer(servers: ServerEntry[]): ServerEntry | null {
  const primary = findPrimaryServer(servers)
  if (primary) {
    return primary
  }

  return [...servers]
    .filter((server) => server.enabled)
    .sort((left, right) => left.sortOrder - right.sortOrder)[0] ?? null
}

function normalizeServerEntry(entry: Partial<ServerEntry>, index: number): ServerEntry {
  return {
    id: typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : createServerId(),
    label: typeof entry.label === 'string' && entry.label.trim() !== '' ? entry.label.trim() : 'Server',
    url: normalizeServerUrl(typeof entry.url === 'string' ? entry.url : window.location.origin),
    color: typeof entry.color === 'string' && entry.color.trim() !== '' ? entry.color : DEFAULT_MULTI_SERVER_COLOR,
    auth: isAuthSession(entry.auth) ? entry.auth : null,
    device: isStoredDevice(entry.device) ? entry.device : null,
    serverInfo: isServerInfo(entry.serverInfo) ? entry.serverInfo : null,
    lastConnectedAt: typeof entry.lastConnectedAt === 'string' ? entry.lastConnectedAt : null,
    sortOrder: typeof entry.sortOrder === 'number' ? entry.sortOrder : index,
    enabled: entry.enabled !== false
  }
}

function migrateLegacySingleServer(): ServerEntry[] {
  const auth = parseJson<AuthSession>(readLocalStorageValue(AUTH_STORAGE_KEY))
  const device = parseJson<StoredDevice>(readLocalStorageValue(STORAGE_KEY))

  if (!auth && !device) {
    return []
  }

  const legacyServer: ServerEntry = {
    id: createServerId(),
    label: defaultServerLabel(null),
    url: normalizeServerUrl(window.location.origin),
    color: DEFAULT_MULTI_SERVER_COLOR,
    auth: auth && isAuthSession(auth) ? auth : null,
    device: device && isStoredDevice(device) ? device : null,
    serverInfo: null,
    lastConnectedAt: null,
    sortOrder: 0,
    enabled: true
  }

  writeLocalStorageValue(AUTH_STORAGE_KEY, null)
  writeLocalStorageValue(STORAGE_KEY, null)

  return [legacyServer]
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') {
    return false
  }

  const session = value as Partial<AuthSession>
  return (
    typeof session.accessToken === 'string' &&
    typeof session.refreshToken === 'string' &&
    !!session.user &&
    typeof session.user.id === 'string' &&
    typeof session.user.username === 'string'
  )
}

function isStoredDevice(value: unknown): value is StoredDevice {
  if (!value || typeof value !== 'object') {
    return false
  }

  const device = value as Partial<StoredDevice>
  const hasNewFormat =
    typeof device.identityKeyPairJson === 'string' &&
    typeof device.registrationId === 'number'
  const hasLegacyFormat = typeof device.privateKeyPkcs8Base64 === 'string'
  return (
    typeof device.deviceId === 'string' &&
    typeof device.deviceName === 'string' &&
    (hasNewFormat || hasLegacyFormat) &&
    typeof device.sessionExpiresAt === 'string' &&
    typeof device.sessionToken === 'string' &&
    typeof device.username === 'string'
  )
}

function isServerInfo(value: unknown): value is ServerInfo {
  if (!value || typeof value !== 'object') {
    return false
  }

  const info = value as Partial<ServerInfo>
  return (
    typeof info.name === 'string' &&
    typeof info.version === 'string' &&
    typeof info.auth_mode === 'string' &&
    typeof info.access_requests_enabled === 'boolean' &&
    typeof info.bootstrap === 'boolean'
  )
}
