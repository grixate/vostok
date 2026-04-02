import type { CallSession } from './api.ts'
import type { StoredDevice } from '../types.ts'

export type GroupMediaSyncState = 'skip' | 'disabled' | 'ready'

export type LocalGeneratedCallKeys = Record<string, Record<number, string>>

export type DirectMediaPairEntry<T> = {
  callId: string
  keyPair: T
}

export function shouldSyncGroupMediaEncryption(
  activeCall: CallSession | null,
  mediaEncryptionSupported: boolean,
  storedDevice: StoredDevice | null,
  membraneClientConnected: boolean
): GroupMediaSyncState {
  if (!activeCall || activeCall.status !== 'active' || activeCall.mode !== 'group') {
    return 'skip'
  }

  if (!mediaEncryptionSupported) {
    return 'disabled'
  }

  if (!storedDevice || !membraneClientConnected) {
    return 'skip'
  }

  return 'ready'
}

export function resolveLocalGeneratedGroupKey(
  localGeneratedCallKeys: LocalGeneratedCallKeys,
  callId: string,
  keyEpoch: number
): string | null {
  return localGeneratedCallKeys[callId]?.[keyEpoch] ?? null
}

export function needsNewDirectMediaKeyPair<T>(
  pairEntry: DirectMediaPairEntry<T> | null,
  callId: string
): boolean {
  return !pairEntry || pairEntry.callId !== callId
}

export function buildDirectMediaKeySignalPayload(publicKeyBase64: string): string {
  return JSON.stringify({
    kind: 'media_e2ee_key',
    public_key: publicKeyBase64
  })
}

export function buildDirectMediaReadySignalPayload(fingerprint: string): string {
  return JSON.stringify({
    kind: 'media_e2ee_ready',
    fingerprint
  })
}
