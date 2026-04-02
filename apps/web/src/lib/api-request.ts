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

    const data = (await response.json().catch(() => ({}))) as T & ApiErrorBody

    if (!response.ok) {
      throw new Error(data.message ?? data.error ?? 'Request failed.')
    }

    return data
  }
}

