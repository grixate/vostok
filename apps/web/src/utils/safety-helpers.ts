import type { SafetyNumberRecord } from '../lib/api'
import type { SafetyNumberEntry } from '../types'

export function toSafetyNumberEntry(record: SafetyNumberRecord): SafetyNumberEntry {
  return {
    peerDeviceId: record.peer_device_id,
    peerUsername: record.peer_username,
    peerDeviceName: record.peer_device_name,
    label: `${record.peer_username} • ${record.peer_device_name}`,
    fingerprint: record.fingerprint,
    verified: record.verified,
    verifiedAt: record.verified_at
  }
}
