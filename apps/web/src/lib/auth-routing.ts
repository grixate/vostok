import { normalizeServerUrl, type ServerEntry } from './multi-server.ts'

export function doesAuthSessionMatchServer(
  authSessionServerUrl: string | null | undefined,
  activeServerUrl: string | null | undefined
): boolean {
  const normalizedActiveServerUrl = activeServerUrl
    ? normalizeServerUrl(activeServerUrl)
    : null
  const normalizedAuthSessionServerUrl = authSessionServerUrl
    ? normalizeServerUrl(authSessionServerUrl)
    : null

  return !normalizedActiveServerUrl || normalizedAuthSessionServerUrl === normalizedActiveServerUrl
}

export function findServerForAuthSession(
  servers: ServerEntry[],
  authSessionServerUrl: string | null | undefined
): ServerEntry | null {
  const normalizedAuthSessionServerUrl = authSessionServerUrl
    ? normalizeServerUrl(authSessionServerUrl)
    : null

  if (!normalizedAuthSessionServerUrl) {
    return null
  }

  return servers.find((server) => normalizeServerUrl(server.url) === normalizedAuthSessionServerUrl) ?? null
}

export function shouldShowOnboarding(
  hasAuthenticatedServer: boolean,
  hasAuthSession: boolean,
  authMatchesActiveServer: boolean
): boolean {
  return !hasAuthenticatedServer && !(hasAuthSession && authMatchesActiveServer)
}
