import { WebRTCEndpoint, type WebRTCEndpointEvents } from '@jellyfish-dev/membrane-webrtc-js'

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

export function createMembraneClient(handlers: MembraneClientHandlers): MembraneClient {
  const client = new WebRTCEndpoint<MembraneEndpointMetadata, MembraneTrackMetadata>()
  const observedTrackIds = new Set<string>()

  const syncRemoteState = () => {
    const remoteEndpoints = Object.values(client.getRemoteEndpoints())
    const remoteTracks = Object.values(client.getRemoteTracks())

    for (const track of remoteTracks) {
      if (observedTrackIds.has(track.trackId)) {
        continue
      }

      observedTrackIds.add(track.trackId)
      track.on('voiceActivityChanged', syncRemoteState)
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

export function receiveMembraneMediaEvent(client: MembraneClient, mediaEvent: string): void {
  client.receiveMediaEvent(mediaEvent)
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
    const trackId = await client.addTrack(track, stream, {
      kind: track.kind as MembraneTrackMetadata['kind'],
      source: 'browser'
    })
    trackIds.push(trackId)
  }

  return trackIds
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

function toTrackKind(value: string | undefined): 'audio' | 'video' | null {
  if (value === 'audio' || value === 'video') {
    return value
  }

  return null
}
