import type { CallParticipant, CallSession, TurnCredentials } from './api.ts'
import type { AuthView } from '../types.ts'
import { isDirectCall } from './call-runtime.ts'
import type { ParsedMediaSignal } from './call-media.ts'

type TransportBootstrapContext = {
  activeCall: CallSession | null
  sessionToken: string | null
  storedDeviceId: string | null
  view: AuthView
}

type PollEndpointContext = {
  activeCall: CallSession | null
  sessionToken: string | null
  view: AuthView
  endpointExists: boolean
}

type AttachTracksContext = {
  activeCall: CallSession | null
  sessionToken: string | null
  view: AuthView
  membraneClientConnected: boolean
  hasMembraneClient: boolean
  hasLocalMediaStream: boolean
  localTrackIdsAttached: boolean
}

export function canBootstrapCallTransport({
  activeCall,
  sessionToken,
  storedDeviceId,
  view
}: TransportBootstrapContext): boolean {
  return Boolean(
    sessionToken &&
    storedDeviceId &&
    activeCall &&
    activeCall.status === 'active' &&
    view === 'chat'
  )
}

export function isParticipantJoined(
  participants: CallParticipant[],
  deviceId: string | null
): boolean {
  if (!deviceId) {
    return false
  }

  return participants.some((participant) => {
    return participant.device_id === deviceId && participant.status === 'joined'
  })
}

export function deriveTurnRefreshDelay(
  turnCredentials: TurnCredentials | null,
  now: number = Date.now()
): number | null {
  if (!turnCredentials) {
    return null
  }

  const expiresAt = Date.parse(turnCredentials.expires_at)
  if (Number.isNaN(expiresAt)) {
    return null
  }

  return Math.max(5_000, expiresAt - now - 60_000)
}

export function shouldPollMembraneEndpoint({
  activeCall,
  sessionToken,
  view,
  endpointExists
}: PollEndpointContext): boolean {
  return Boolean(
    sessionToken &&
    activeCall &&
    activeCall.status === 'active' &&
    view === 'chat' &&
    endpointExists
  )
}

export function shouldAttachLocalTracks({
  activeCall,
  sessionToken,
  view,
  membraneClientConnected,
  hasMembraneClient,
  hasLocalMediaStream,
  localTrackIdsAttached
}: AttachTracksContext): boolean {
  return Boolean(
    activeCall &&
    sessionToken &&
    view === 'chat' &&
    membraneClientConnected &&
    hasMembraneClient &&
    hasLocalMediaStream &&
    !localTrackIdsAttached
  )
}

export function shouldSyncDirectMediaEncryption(
  activeCall: CallSession | null,
  mediaEncryptionSupported: boolean,
  sessionToken: string | null,
  membraneClientConnected: boolean
): 'disabled' | 'negotiating' | 'ready' | 'skip' {
  if (!activeCall || activeCall.status !== 'active' || !isDirectCall(activeCall)) {
    return 'skip'
  }

  if (!mediaEncryptionSupported) {
    return 'disabled'
  }

  if (!sessionToken || !membraneClientConnected) {
    return 'negotiating'
  }

  return 'ready'
}

export function findRemoteMediaKeySignal(
  callSignals: Array<{ from_device_id: string; payload: string }>,
  localDeviceId: string | null,
  parseSignal: (payload: string) => ParsedMediaSignal | null
): { publicKey: string } | null {
  const remoteSignal = [...callSignals]
    .reverse()
    .map((signal) => ({ signal, parsed: parseSignal(signal.payload) }))
    .find(({ signal, parsed }) => {
      return signal.from_device_id !== localDeviceId && parsed?.kind === 'media_e2ee_key'
    })

  if (!remoteSignal || remoteSignal.parsed?.kind !== 'media_e2ee_key') {
    return null
  }

  return { publicKey: remoteSignal.parsed.public_key }
}

export function hasMatchingRemoteReadySignal(
  callSignals: Array<{ from_device_id: string; payload: string }>,
  localDeviceId: string | null,
  fingerprint: string,
  parseSignal: (payload: string) => ParsedMediaSignal | null
): boolean {
  return callSignals
    .map((signal) => ({ signal, parsed: parseSignal(signal.payload) }))
    .some(({ signal, parsed }) => {
      return (
        signal.from_device_id !== localDeviceId &&
        parsed?.kind === 'media_e2ee_ready' &&
        parsed.fingerprint === fingerprint
      )
    })
}
