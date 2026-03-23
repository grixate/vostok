import { useState, useEffect, useCallback } from 'react'

// Module-level cache so all components share the same photo URLs
const photoCache = new Map<string, string | null>()
const fetchInFlight = new Map<string, Promise<string | null>>()

function photoUrl(userId: string): string {
  return `/api/v1/users/${userId}/photo`
}

async function resolvePhoto(userId: string): Promise<string | null> {
  if (photoCache.has(userId)) return photoCache.get(userId) ?? null

  const existing = fetchInFlight.get(userId)
  if (existing) return existing

  const promise = fetch(photoUrl(userId))
    .then((r) => {
      if (r.ok) {
        const url = `${photoUrl(userId)}?v=${Date.now()}`
        photoCache.set(userId, url)
        return url
      }
      photoCache.set(userId, null)
      return null
    })
    .catch(() => {
      photoCache.set(userId, null)
      return null
    })
    .finally(() => {
      fetchInFlight.delete(userId)
    })

  fetchInFlight.set(userId, promise)
  return promise
}

/** Invalidate a user's cached photo (after upload/delete). */
export function invalidateProfilePhoto(userId: string) {
  photoCache.delete(userId)
  fetchInFlight.delete(userId)
}

/** Get a cached profile photo URL synchronously (null if not loaded or no photo). */
export function getCachedPhotoUrl(userId: string): string | null {
  return photoCache.get(userId) ?? null
}

/**
 * Hook that resolves profile photos for a set of user IDs.
 * Returns a Map<userId, photoUrl>.
 */
export function useProfilePhotos(userIds: string[]): Map<string, string> {
  const [photos, setPhotos] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (userIds.length === 0) return

    let cancelled = false

    async function load() {
      const results = new Map<string, string>()
      for (const id of userIds) {
        const url = await resolvePhoto(id)
        if (url) results.set(id, url)
      }
      if (!cancelled) setPhotos(results)
    }

    void load()
    return () => { cancelled = true }
  }, [userIds.join(',')])

  return photos
}

/**
 * Hook that resolves a single user's profile photo.
 */
export function useProfilePhoto(userId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    userId ? photoCache.get(userId) ?? null : null
  )

  useEffect(() => {
    if (!userId) { setUrl(null); return }

    const cached = photoCache.get(userId)
    if (cached !== undefined) { setUrl(cached); return }

    let cancelled = false
    resolvePhoto(userId).then((result) => {
      if (!cancelled) setUrl(result)
    })
    return () => { cancelled = true }
  }, [userId])

  return url
}
