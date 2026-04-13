import type { CallSession } from './api.ts'
import type { StoredDevice } from '../types.ts'

export type GroupMediaSyncState = 'skip' | 'disabled' | 'ready'

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
