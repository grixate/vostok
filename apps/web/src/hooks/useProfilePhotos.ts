import { useState, useEffect, useMemo } from 'react'
import { getDefaultApiBaseUrl } from '../lib/api.ts'

// Module-level cache so all components share the same photo URLs.
// On init, restore "no photo" entries from sessionStorage so 404s
// are not re-fetched on page reload.
const NO_PHOTO_STORAGE_KEY = 'vostok:no_photo'
const photoCache = new Map<string, string | null>()
const fetchInFlight = new Map<string, Promise<string | null>>()

try {
  const stored = sessionStorage.getItem(NO_PHOTO_STORAGE_KEY)
  if (stored) {
    for (const key of JSON.parse(stored) as string[]) {
      photoCache.set(key, null)
    }
  }
} catch { /* ignore */ }

let persistTimer: ReturnType<typeof setTimeout> | null = null

function persistNoPhotoCache() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      const keys = [...photoCache.entries()]
        .filter(([, v]) => v === null)
        .map(([k]) => k)
      sessionStorage.setItem(NO_PHOTO_STORAGE_KEY, JSON.stringify(keys))
    } catch { /* ignore */ }
  }, 500)
}

function normalizeBaseUrl(baseUrl?: string | null): string {
  const candidate = baseUrl ?? getDefaultApiBaseUrl() ?? window.location.origin

  try {
    return new URL(candidate, window.location.origin).toString().replace(/\/+$/, '')
  } catch {
    return window.location.origin
  }
}

export function buildProfilePhotoUrl(userId: string, baseUrl?: string | null, bustCache = false): string {
  const url = new URL(`/api/v1/users/${userId}/photo`, normalizeBaseUrl(baseUrl))

  if (bustCache) {
    url.searchParams.set('v', String(Date.now()))
  }

  return url.toString()
}

function photoCacheKey(userId: string, baseUrl?: string | null): string {
  return `${normalizeBaseUrl(baseUrl)}::${userId}`
}

function photoMapsEqual(left: Map<string, string>, right: Map<string, string>): boolean {
  if (left.size !== right.size) {
    return false
  }

  for (const [key, value] of left.entries()) {
    if (right.get(key) !== value) {
      return false
    }
  }

  return true
}

async function resolvePhoto(userId: string, baseUrl?: string | null): Promise<string | null> {
  const cacheKey = photoCacheKey(userId, baseUrl)

  if (photoCache.has(cacheKey)) return photoCache.get(cacheKey) ?? null

  const existing = fetchInFlight.get(cacheKey)
  if (existing) return existing

  const requestUrl = buildProfilePhotoUrl(userId, baseUrl)
  const promise = fetch(requestUrl)
    .then((r) => {
      if (r.ok) {
        const url = buildProfilePhotoUrl(userId, baseUrl, true)
        photoCache.set(cacheKey, url)
        return url
      }
      photoCache.set(cacheKey, null)
      persistNoPhotoCache()
      return null
    })
    .catch(() => {
      photoCache.set(cacheKey, null)
      persistNoPhotoCache()
      return null
    })
    .finally(() => {
      fetchInFlight.delete(cacheKey)
    })

  fetchInFlight.set(cacheKey, promise)
  return promise
}

/** Invalidate a user's cached photo (after upload/delete). */
export function invalidateProfilePhoto(userId: string, baseUrl?: string | null) {
  const cacheKey = photoCacheKey(userId, baseUrl)
  photoCache.delete(cacheKey)
  fetchInFlight.delete(cacheKey)
  persistNoPhotoCache()
}

/** Get a cached profile photo URL synchronously (null if not loaded or no photo). */
export function getCachedPhotoUrl(userId: string, baseUrl?: string | null): string | null {
  return photoCache.get(photoCacheKey(userId, baseUrl)) ?? null
}

/**
 * Hook that resolves profile photos for a set of user IDs.
 * Returns a Map<userId, photoUrl>.
 */
export function useProfilePhotos(userIds: string[], baseUrl?: string | null): Map<string, string> {
  const [photos, setPhotos] = useState<Map<string, string>>(new Map())
  const resolvedBaseUrl = useMemo(() => normalizeBaseUrl(baseUrl), [baseUrl])
  const userIdsKey = userIds.join(',')
  const stableUserIds = useMemo(() => userIds.filter(Boolean), [userIdsKey])

  useEffect(() => {
    if (stableUserIds.length === 0) {
      setPhotos((current) => (current.size === 0 ? current : new Map()))
      return
    }

    let cancelled = false

    async function load() {
      const results = new Map<string, string>()
      for (const id of stableUserIds) {
        const url = await resolvePhoto(id, resolvedBaseUrl)
        if (url) results.set(id, url)
      }
      if (!cancelled) {
        setPhotos((current) => (photoMapsEqual(current, results) ? current : results))
      }
    }

    void load()
    return () => { cancelled = true }
  }, [resolvedBaseUrl, stableUserIds])

  return photos
}

/**
 * Hook that resolves a single user's profile photo.
 */
export function useProfilePhoto(userId: string | null | undefined, baseUrl?: string | null): string | null {
  const resolvedBaseUrl = useMemo(() => normalizeBaseUrl(baseUrl), [baseUrl])
  const cacheKey = userId ? photoCacheKey(userId, resolvedBaseUrl) : null
  const [resolvedPhoto, setResolvedPhoto] = useState<{ cacheKey: string | null; url: string | null } | null>(null)

  useEffect(() => {
    if (!userId || !cacheKey || photoCache.has(cacheKey)) return

    let cancelled = false
    resolvePhoto(userId, resolvedBaseUrl).then((result) => {
      if (!cancelled) {
        setResolvedPhoto({ cacheKey, url: result })
      }
    })
    return () => { cancelled = true }
  }, [cacheKey, resolvedBaseUrl, userId])

  if (!userId || !cacheKey) {
    return null
  }

  if (resolvedPhoto?.cacheKey === cacheKey) {
    return resolvedPhoto.url
  }

  return photoCache.get(cacheKey) ?? null
}
