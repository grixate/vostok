import { WebRTCEndpoint, type WebRTCEndpointEvents } from '@jellyfish-dev/membrane-webrtc-js'
import type { TurnCredentials } from './api.ts'
import { turnCredentialsToIceServers } from './call-runtime.ts'

export type MembraneEndpointMetadata = {
  call_id: string
  device_id: string
  mode: string
  source: string
  username?: string
}

export type MembraneTrackMetadata = {
  kind: 'audio' | 'video'
  source: string
}

export type MembraneRemoteEndpointSnapshot = {
  id: string
  type: string
  username: string | null
  deviceId: string | null
  trackIds: string[]
}

export type MembraneRemoteTrackSnapshot = {
  id: string
  endpointId: string
  kind: 'audio' | 'video' | null
  source: string | null
  ready: boolean
  mediaTrack: MediaStreamTrack | null
  voiceActivity: 'speech' | 'silence' | null
}

export type MembraneLocalTrackSnapshot = {
  trackId: string
  mediaTrackId: string | null
  kind: 'audio' | 'video' | null
  source: string | null
}

export type MembranePeerConnectionSnapshot = {
  connectionState: RTCPeerConnectionState | null
  iceConnectionState: RTCIceConnectionState | null
  iceGatheringState: RTCIceGatheringState | null
  signalingState: RTCSignalingState | null
}

export type MembraneClient = WebRTCEndpoint<MembraneEndpointMetadata, MembraneTrackMetadata>

export type MembraneClientHandlers = {
  onSendMediaEvent?: (mediaEvent: string) => void
  onConnected?: (payload: { endpointId: string; otherEndpointCount: number }) => void
  onDisconnected?: () => void
  onRemoteStateChange?: (payload: {
    endpointCount: number
    trackCount: number
    endpointIds: string[]
    trackIds: string[]
    readyTrackCount: number
    readyAudioTrackCount: number
    readyVideoTrackCount: number
    endpoints: MembraneRemoteEndpointSnapshot[]
    tracks: MembraneRemoteTrackSnapshot[]
  }) => void
  onConnectionError?: (message: string) => void
}

type InternalMembraneClient = {
  connection?: RTCPeerConnection
  onTrack?: () => (event: RTCTrackEvent) => void
  midToTrackId?: Map<string | null, string>
  trackIdToTrack?: Map<string, {
    stream: MediaStream | null
    track: MediaStreamTrack | null
  }>
  localEndpoint?: unknown
  checkIfTrackBelongToEndpoint?: (trackId: string, endpoint?: unknown) => boolean
}

function installSafeOnTrackHandler(client: MembraneClient): void {
  const internalClient = client as unknown as InternalMembraneClient
  const pendingTracksByMid = new Map<string | null, { stream: MediaStream | null; track: MediaStreamTrack }>()

  const applyPendingTracks = () => {
    if (pendingTracksByMid.size === 0) {
      return
    }

    for (const [mid, pending] of pendingTracksByMid) {
      const trackId = internalClient.midToTrackId?.get(mid)
      if (!trackId) {
        continue
      }

      const trackContext = internalClient.trackIdToTrack?.get(trackId)
      if (!trackContext) {
        continue
      }

      trackContext.stream = pending.stream
      trackContext.track = pending.track
      client.emit('trackReady', trackContext as never)
      pendingTracksByMid.delete(mid)
    }
  }

  const originalOnTrackFactory = internalClient.onTrack?.bind(internalClient)
  if (!originalOnTrackFactory) {
    return
  }

  internalClient.onTrack = () => (event: RTCTrackEvent) => {
    const [stream] = event.streams
    const mid = event.transceiver?.mid ?? null
    const trackId = internalClient.midToTrackId?.get(mid)

    if (!trackId) {
      pendingTracksByMid.set(mid, { stream: stream ?? null, track: event.track })
      return
    }

    if (internalClient.checkIfTrackBelongToEndpoint?.(trackId, internalClient.localEndpoint)) {
      return
    }

    const trackContext = internalClient.trackIdToTrack?.get(trackId)
    if (!trackContext) {
      pendingTracksByMid.set(mid, { stream: stream ?? null, track: event.track })
      return
    }

    trackContext.stream = stream ?? null
    trackContext.track = event.track
    client.emit('trackReady', trackContext as never)
  }

  // Re-evaluate pending on every remote-state sync; this captures late
  // trackId mapping updates after renegotiation.
  const originalSyncHook = () => {
    applyPendingTracks()
  }
  ;(client as unknown as { __vostokApplyPendingOnTrack?: () => void }).__vostokApplyPendingOnTrack = originalSyncHook
}

export function createMembraneClient(handlers: MembraneClientHandlers): MembraneClient {
  const client = new WebRTCEndpoint<MembraneEndpointMetadata, MembraneTrackMetadata>()
  installSafeOnTrackHandler(client)
  const observedTrackIds = new Set<string>()

  const syncRemoteState = () => {
    const applyPendingOnTrack = (client as unknown as { __vostokApplyPendingOnTrack?: () => void }).__vostokApplyPendingOnTrack
    applyPendingOnTrack?.()

    const remoteEndpoints = Object.values(client.getRemoteEndpoints())
    const remoteTracks = Object.values(client.getRemoteTracks())

    for (const track of remoteTracks) {
      if (observedTrackIds.has(track.trackId)) {
        continue
      }

      observedTrackIds.add(track.trackId)
      // Voice activity can fire at very high frequency when a remote mic is unmuted.
      // We don't currently consume VAD in UI logic, so avoid flooding React state updates.
      track.on('encodingChanged', syncRemoteState)
    }

    const endpoints = remoteEndpoints
      .map((endpoint) => ({
        id: endpoint.id,
        type: endpoint.type,
        username: endpoint.metadata?.username ?? null,
        deviceId: endpoint.metadata?.device_id ?? null,
        trackIds: Array.from(endpoint.tracks.keys()).sort()
      }))
      .sort((left, right) => left.id.localeCompare(right.id))

    const tracks = remoteTracks
      .map((track) => ({
        id: track.trackId,
        endpointId: track.endpoint.id,
        kind: toTrackKind(track.track?.kind ?? track.metadata?.kind),
        source: track.metadata?.source ?? null,
        ready: track.track !== null,
        mediaTrack: track.track,
        voiceActivity:
          track.vadStatus === 'speech' || track.vadStatus === 'silence' ? track.vadStatus : null
      }))
      .sort((left, right) => left.id.localeCompare(right.id))

    const endpointIds = endpoints.map((endpoint) => endpoint.id)
    const trackIds = tracks.map((track) => track.id)
    const readyTracks = tracks.filter((track) => track.ready)

    handlers.onRemoteStateChange?.({
      endpointCount: endpointIds.length,
      trackCount: trackIds.length,
      endpointIds,
      trackIds,
      readyTrackCount: readyTracks.length,
      readyAudioTrackCount: readyTracks.filter((track) => track.kind === 'audio').length,
      readyVideoTrackCount: readyTracks.filter((track) => track.kind === 'video').length,
      endpoints,
      tracks
    })
  }

  client.on('sendMediaEvent', (mediaEvent) => {
    handlers.onSendMediaEvent?.(mediaEvent)
  })

  client.on('connected', (endpointId, otherEndpoints) => {
    handlers.onConnected?.({
      endpointId,
      otherEndpointCount: otherEndpoints.length
    })
    syncRemoteState()
  })

  client.on('disconnected', () => {
    handlers.onDisconnected?.()
    syncRemoteState()
  })

  for (const eventName of [
    'endpointAdded',
    'endpointRemoved',
    'trackAdded',
    'trackRemoved',
    'trackReady'
  ] satisfies Array<keyof WebRTCEndpointEvents<MembraneEndpointMetadata, MembraneTrackMetadata>>) {
    client.on(eventName, () => {
      syncRemoteState()
    })
  }

  client.on('connectionError', (message) => {
    handlers.onConnectionError?.(message)
  })

  return client
}

export function connectMembraneClient(
  client: MembraneClient,
  metadata: MembraneEndpointMetadata
): void {
  client.connect(metadata)
}

export function configureMembraneTurnServers(
  client: MembraneClient,
  turnCredentials: TurnCredentials | null
): void {
  const internalClient = client as unknown as {
    rtcConfig?: RTCConfiguration
    __baseIceServers?: RTCIceServer[]
  }

  if (!internalClient.rtcConfig) {
    internalClient.rtcConfig = { iceServers: [] }
  }

  internalClient.rtcConfig.iceServers = turnCredentials
    ? turnCredentialsToIceServers(turnCredentials)
    : []
  internalClient.rtcConfig.iceTransportPolicy = 'all'

  internalClient.__baseIceServers = [...(internalClient.rtcConfig.iceServers ?? [])]
}

export function receiveMembraneMediaEvent(client: MembraneClient, mediaEvent: string): void {
  const normalizedMediaEvent = normalizeIntegratedTurnServers(client, mediaEvent)
  client.receiveMediaEvent(normalizedMediaEvent)
}

export function shouldSkipStaleMembraneMediaEvent(
  client: MembraneClient,
  mediaEvent: string
): boolean {
  const internalClient = client as unknown as {
    idToEndpoint?: Map<string, { id: string; tracks: Map<string, unknown> }>
    localEndpoint?: { id?: string | null }
    trackIdToTrack?: Map<string, unknown>
  }

  try {
    const parsed = JSON.parse(mediaEvent) as {
      type?: unknown
      data?: {
        id?: unknown
        endpointId?: unknown
        trackIds?: unknown
      }
    }

    if (parsed.type === 'endpointRemoved') {
      const endpointId = typeof parsed.data?.id === 'string' ? parsed.data.id : null

      if (!endpointId || endpointId === internalClient.localEndpoint?.id) {
        return false
      }

      return !internalClient.idToEndpoint?.has(endpointId)
    }

    if (parsed.type === 'tracksRemoved') {
      const endpointId = typeof parsed.data?.endpointId === 'string' ? parsed.data.endpointId : null
      const trackIds = Array.isArray(parsed.data?.trackIds)
        ? parsed.data.trackIds.filter((trackId): trackId is string => typeof trackId === 'string')
        : []

      if (!endpointId || endpointId === internalClient.localEndpoint?.id) {
        return false
      }

      const endpoint = internalClient.idToEndpoint?.get(endpointId)

      if (!endpoint) {
        return true
      }

      if (trackIds.length === 0) {
        return false
      }

      return trackIds.every((trackId) => {
        return !endpoint.tracks.has(trackId) && !internalClient.trackIdToTrack?.has(trackId)
      })
    }
  } catch {
    return false
  }

  return false
}

export function updateMembraneEndpointMetadata(
  client: MembraneClient,
  metadata: Record<string, unknown>
): void {
  client.updateEndpointMetadata(metadata)
}

export async function attachLocalTracksToMembrane(
  client: MembraneClient,
  stream: MediaStream
): Promise<string[]> {
  const trackIds: string[] = []

  for (const track of stream.getTracks()) {
    const trackId = await attachLocalTrackToMembrane(client, track, stream)
    trackIds.push(trackId)
  }

  return trackIds
}

export async function attachLocalTrackToMembrane(
  client: MembraneClient,
  track: MediaStreamTrack,
  stream: MediaStream,
  source: MembraneTrackMetadata['source'] = 'browser'
): Promise<string> {
  const trackStream = new MediaStream([track])
  const streamForTrack = stream.getTracks().some((candidate) => candidate.id === track.id)
    ? trackStream
    : stream

  return client.addTrack(track, streamForTrack, {
    kind: track.kind as MembraneTrackMetadata['kind'],
    source
  })
}

export async function replaceLocalTrackInMembrane(
  client: MembraneClient,
  trackId: string,
  track: MediaStreamTrack,
  metadata?: Partial<MembraneTrackMetadata>
): Promise<boolean> {
  const replaceTrack = (
    client as unknown as {
      replaceTrack: (
        trackId: string,
        track: MediaStreamTrack,
        metadata?: Partial<MembraneTrackMetadata>
      ) => Promise<boolean>
    }
  ).replaceTrack

  return replaceTrack.call(client, trackId, track, {
    kind: track.kind as MembraneTrackMetadata['kind'],
    source: metadata?.source ?? 'browser'
  })
}

export async function removeLocalTracksFromMembrane(
  client: MembraneClient | null,
  trackIds: string[]
): Promise<void> {
  if (!client || trackIds.length === 0) {
    return
  }

  await Promise.allSettled(trackIds.map((trackId) => client.removeTrack(trackId)))
}

export function cleanupMembraneClient(client: MembraneClient | null): void {
  client?.cleanUp()
}

export function getMembranePeerConnection(client: MembraneClient | null): RTCPeerConnection | null {
  if (!client) {
    return null
  }

  const internalClient = client as unknown as { connection?: RTCPeerConnection | null }
  return internalClient.connection ?? null
}

export function getMembranePeerConnectionSnapshot(
  client: MembraneClient | null
): MembranePeerConnectionSnapshot {
  const connection = getMembranePeerConnection(client)

  if (!connection) {
    return {
      connectionState: null,
      iceConnectionState: null,
      iceGatheringState: null,
      signalingState: null
    }
  }

  return {
    connectionState: connection.connectionState,
    iceConnectionState: connection.iceConnectionState,
    iceGatheringState: connection.iceGatheringState,
    signalingState: connection.signalingState
  }
}

export function getMembraneLocalTrackSnapshots(client: MembraneClient | null): MembraneLocalTrackSnapshot[] {
  if (!client) {
    return []
  }

  const internalClient = client as unknown as {
    localTrackIdToTrack?: Map<string, {
      track?: MediaStreamTrack | null
      metadata?: Partial<MembraneTrackMetadata> | null
    }>
  }

  const entries = Array.from(internalClient.localTrackIdToTrack?.entries() ?? [])

  return entries
    .map(([trackId, context]) => ({
      trackId,
      mediaTrackId: context.track?.id ?? null,
      kind: context.metadata?.kind ?? null,
      source: context.metadata?.source ?? null
    }))
    .sort((left, right) => left.trackId.localeCompare(right.trackId))
}

export function findMembraneLocalTrackId(
  client: MembraneClient | null,
  track: MediaStreamTrack | null,
  kind?: MembraneTrackMetadata['kind'],
  source?: MembraneTrackMetadata['source']
): string | null {
  if (!client || !track) {
    return null
  }

  const internalClient = client as unknown as {
    localTrackIdToTrack?: Map<string, {
      track?: MediaStreamTrack | null
      metadata?: Partial<MembraneTrackMetadata> | null
    }>
  }

  const entries = internalClient.localTrackIdToTrack?.entries()

  if (!entries) {
    return null
  }

  for (const [trackId, context] of entries) {
    if (context.track?.id !== track.id) {
      continue
    }

    if (kind && context.metadata?.kind && context.metadata.kind !== kind) {
      continue
    }

    if (source && context.metadata?.source && context.metadata.source !== source) {
      continue
    }

    return trackId
  }

  return null
}

export function isMembranePeerConnectionHealthy(client: MembraneClient | null): boolean {
  const connection = getMembranePeerConnection(client)

  if (!connection) {
    return false
  }

  if (connection.connectionState !== 'connected') {
    return false
  }

  return connection.iceConnectionState === 'connected' || connection.iceConnectionState === 'completed'
}

export function canMutateMembraneTracks(client: MembraneClient | null): boolean {
  const connection = getMembranePeerConnection(client)

  if (!connection) {
    return false
  }

  if (connection.signalingState === 'closed') {
    return false
  }

  if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
    return false
  }

  return connection.iceConnectionState !== 'failed' && connection.iceConnectionState !== 'closed'
}

function toTrackKind(value: string | undefined): 'audio' | 'video' | null {
  if (value === 'audio' || value === 'video') {
    return value
  }

  return null
}

export function normalizeIntegratedTurnServers(
  _client: MembraneClient,
  mediaEvent: string
): string {
  return mediaEvent
}

export function filterOutgoingMembraneCandidateEvent(mediaEvent: string): string | null {
  return mediaEvent
}
