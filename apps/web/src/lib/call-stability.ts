export const CALL_RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000] as const
export const CALL_EVENT_DEDUPE_WINDOW_MS = 1_500
export const CALL_RECONNECT_STABLE_RESET_MS = 30_000
export const CALL_RECONNECT_EVENT_QUEUE_LIMIT = 256
export const CALL_REALTIME_EVENT_ARBITRATION_WINDOW_MS = 4_000

export type LocalSenderSnapshot = {
  trackId: string
  kind: 'audio' | 'video' | null
  source: string | null
  mediaTrackId: string | null
}

export function isCallDebugVerboseEnabled(options: {
  dev: boolean
  buildVerbose: boolean
  runtimeOverride: string | null
}): boolean {
  if (!options.dev) {
    return false
  }

  if (options.runtimeOverride === '0') {
    return false
  }

  if (options.runtimeOverride === '1') {
    return true
  }

  return options.buildVerbose || options.runtimeOverride == null
}

export function nextReconnectDelayMs(attempt: number): number {
  if (attempt <= 0) {
    return CALL_RECONNECT_BACKOFF_MS[0]
  }

  const index = Math.min(attempt, CALL_RECONNECT_BACKOFF_MS.length - 1)
  return CALL_RECONNECT_BACKOFF_MS[index]
}

export function shouldResetReconnectAttempts(
  lastStableAt: number | null,
  now: number
): boolean {
  return lastStableAt != null && now - lastStableAt >= CALL_RECONNECT_STABLE_RESET_MS
}

export function shouldBypassMembraneEventDedupe(
  negotiationEventKind: string | null
): boolean {
  return (
    negotiationEventKind === 'offerData' ||
    negotiationEventKind === 'answer' ||
    negotiationEventKind === 'candidate'
  )
}

export function shouldSkipPolledCriticalEvent(
  lastRealtimeSeenAt: number | null | undefined,
  now: number
): boolean {
  return (
    lastRealtimeSeenAt != null &&
    now - lastRealtimeSeenAt <= CALL_REALTIME_EVENT_ARBITRATION_WINDOW_MS
  )
}

export function selectPrimaryLocalSenderTrackIds(
  snapshots: LocalSenderSnapshot[],
  activeTrackIds: { audio: string | null; video: string | null }
): { keep: string[]; remove: string[] } {
  const keep: string[] = []
  const remove: string[] = []

  for (const kind of ['audio', 'video'] as const) {
    const candidates = snapshots.filter((snapshot) => snapshot.kind === kind)
    if (candidates.length <= 1) {
      if (candidates[0]) {
        keep.push(candidates[0].trackId)
      }
      continue
    }

    const activeTrackId = activeTrackIds[kind]
    const preferred =
      (activeTrackId
        ? candidates.find((snapshot) => snapshot.mediaTrackId === activeTrackId) ?? null
        : null) ??
      candidates.find((snapshot) => snapshot.source === 'browser') ??
      candidates[0]

    for (const candidate of candidates) {
      if (candidate.trackId === preferred.trackId) {
        keep.push(candidate.trackId)
      } else {
        remove.push(candidate.trackId)
      }
    }
  }

  return { keep, remove }
}
