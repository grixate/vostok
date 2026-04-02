import type { CallSession, TurnCredentials } from './api.ts'

export type CallCapabilityState =
  | 'supported'
  | 'unsupported_transform'
  | 'unsupported_worker'
  | 'unsupported_media_capture'
  | 'unsupported_browser'

export type DirectCallStatus =
  | 'idle'
  | 'ringing_outgoing'
  | 'ringing_incoming'
  | 'connecting'
  | 'active'
  | 'ending'
  | 'ended'
  | 'error'

export type DirectCallTransportReadiness = {
  localMediaReady: boolean
  endpointReady: boolean
  turnReady: boolean
  membraneConnected: boolean
}

export function isCallCapabilitySupported(state: CallCapabilityState): boolean {
  return state === 'supported'
}

type DirectCallStatusInput = {
  activeCall: CallSession | null
  localDeviceId: string | null
  transportReadiness: DirectCallTransportReadiness
  transportError: string | null
  isEnding: boolean
}

export function isDirectCall(call: CallSession | null): call is CallSession {
  return Boolean(call && (call.mode === 'voice' || call.mode === 'video'))
}

export function deriveDirectCallStatus({
  activeCall,
  localDeviceId,
  transportReadiness,
  transportError,
  isEnding
}: DirectCallStatusInput): DirectCallStatus {
  if (transportError) {
    return 'error'
  }

  if (isEnding) {
    return 'ending'
  }

  if (!activeCall || activeCall.status === 'ended' || !isDirectCall(activeCall)) {
    return 'idle'
  }

  if (activeCall.status === 'ringing') {
    return activeCall.started_by_device_id === localDeviceId
      ? 'ringing_outgoing'
      : 'ringing_incoming'
  }

  if (
    transportReadiness.localMediaReady &&
    transportReadiness.endpointReady &&
    transportReadiness.turnReady &&
    transportReadiness.membraneConnected
  ) {
    return 'active'
  }

  return 'connecting'
}

export function shouldRefreshTurnCredentials(
  turnCredentials: TurnCredentials | null,
  now: number = Date.now()
): boolean {
  if (!turnCredentials) {
    return true
  }

  const expiresAt = Date.parse(turnCredentials.expires_at)

  if (Number.isNaN(expiresAt)) {
    return true
  }

  return expiresAt - now <= 60_000
}

export function turnCredentialsToIceServers(turnCredentials: TurnCredentials): RTCIceServer[] {
  if (turnCredentials.uris.length === 0) {
    return []
  }

  return [
    {
      urls: turnCredentials.uris,
      username: turnCredentials.username,
      credential: turnCredentials.password
    }
  ]
}

export function buildDirectCallStatusLabel(
  status: DirectCallStatus,
  mode: 'voice' | 'video' | null,
  transportError: string | null
): string {
  switch (status) {
    case 'ringing_incoming':
      return `Incoming ${mode ?? 'voice'} call…`
    case 'ringing_outgoing':
      return mode === 'video' ? 'Starting video call…' : 'Calling…'
    case 'connecting':
      return mode === 'video' ? 'Connecting video…' : 'Connecting audio…'
    case 'active':
      return mode === 'video' ? 'Live video call' : 'Live voice call'
    case 'ending':
      return 'Ending call…'
    case 'error':
      return transportError ?? 'Call transport failed.'
    case 'ended':
      return 'Call ended'
    case 'idle':
    default:
      return mode === 'video' ? 'Video call' : 'Voice call'
  }
}
