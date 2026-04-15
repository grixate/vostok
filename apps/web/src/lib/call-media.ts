import type { CallKeyDistribution, CallSession } from './api.ts'

export type ParsedMediaSignal =
  | { kind: 'media_e2ee_key'; public_key: string }
  | { kind: 'media_e2ee_ready'; fingerprint: string }

export type CallJoinPayload = {
  track_kind: 'audio' | 'audio_video'
  e2ee_capable?: boolean
  e2ee_algorithm?: string
  e2ee_key_epoch?: number
}

export function preferredTrackKind(call: CallSession): 'audio' | 'audio_video' {
  const mediaMode = call.mode === 'group' ? call.media_mode : call.mode
  return mediaMode === 'video' ? 'audio_video' : 'audio'
}

export function selectLatestCallKey(keys: CallKeyDistribution[]): CallKeyDistribution | null {
  return [...keys].sort((left, right) => right.key_epoch - left.key_epoch)[0] ?? null
}

export function latestCallKeyForDevice(
  call: CallSession | null,
  callKeys: CallKeyDistribution[],
  deviceId: string | null
): CallKeyDistribution | null {
  if (!call || call.mode !== 'group' || !deviceId) {
    return null
  }

  const relevantKeys = callKeys.filter((key) => {
    return key.owner_device_id === deviceId || key.recipient_device_id === deviceId
  })

  return selectLatestCallKey(relevantKeys)
}

export function computeNextCallKeyEpoch(callKeys: CallKeyDistribution[]): number {
  return Math.max(0, ...callKeys.map((key) => key.key_epoch)) + 1
}

export function buildJoinPayload(
  call: CallSession,
  _latestCallKey: CallKeyDistribution | null
): CallJoinPayload {
  return {
    track_kind: preferredTrackKind(call),
    e2ee_capable: true,
    e2ee_algorithm: 'signal-v2'
  }
}

export function parseMediaSignal(payload: string): ParsedMediaSignal | null {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>

    if (parsed.kind === 'media_e2ee_key' && typeof parsed.public_key === 'string') {
      return { kind: 'media_e2ee_key', public_key: parsed.public_key }
    }

    if (parsed.kind === 'media_e2ee_ready' && typeof parsed.fingerprint === 'string') {
      return { kind: 'media_e2ee_ready', fingerprint: parsed.fingerprint }
    }
  } catch {
    // Ignore malformed or non-media signaling payloads.
  }

  return null
}
