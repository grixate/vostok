import { readAuthSession, persistAuthSession } from '../utils/storage.ts'

export type ApiErrorBody = {
  error?: string
  message?: string
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function buildApiRoot(baseUrl: string): string {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl)
  return `${normalizedBaseUrl}/api/v1`
}

// ── Token refresh singleton ──────────────────────────────────────────────
// Ensures only one refresh is in-flight at a time. All concurrent 401
// retries share the same refresh promise.
let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(apiRoot: string): Promise<string | null> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const session = readAuthSession()
      if (!session?.refreshToken) return null

      const response = await fetch(`${apiRoot}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refreshToken })
      })

      if (!response.ok) return null

      const data = await response.json() as {
        access_token: string
        user: { id: string; username: string; display_name: string | null; role: string; temp_password: boolean }
      }

      const updated = {
        ...session,
        accessToken: data.access_token,
        user: {
          id: data.user.id,
          username: data.user.username,
          display_name: data.user.display_name,
          role: data.user.role,
          temp_password: data.user.temp_password
        }
      }
      persistAuthSession(updated)
      return data.access_token
    } catch {
      return null
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

// ── API request factory ─────────────────────────────────────────────────
export function createApiRequest(baseUrl: string) {
  const apiRoot = buildApiRoot(baseUrl)

  return async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${apiRoot}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {})
      }
    })

    if (response.status === 401) {
      // Only attempt refresh if the request had an auth header
      const authHeader = (init.headers as Record<string, string> | undefined)?.Authorization
      if (authHeader) {
        const newToken = await refreshAccessToken(apiRoot)
        if (newToken) {
          // Retry with the fresh token
          const retryResponse = await fetch(`${apiRoot}${path}`, {
            ...init,
            headers: {
              'Content-Type': 'application/json',
              ...(init.headers ?? {}),
              Authorization: `Bearer ${newToken}`
            }
          })

          const retryData = (await retryResponse.json().catch(() => ({}))) as T & ApiErrorBody

          if (!retryResponse.ok) {
            throw new Error(retryData.message ?? retryData.error ?? 'Request failed.')
          }

          return retryData
        }
      }
    }

    const data = (await response.json().catch(() => ({}))) as T & ApiErrorBody

    if (!response.ok) {
      throw new Error(data.message ?? data.error ?? 'Request failed.')
    }

    return data
  }
}
