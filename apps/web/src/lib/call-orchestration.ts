import type {
  CallParticipant,
  CallRoomState,
  CallSession,
  CallWebRtcEndpointState,
  TurnCredentials
} from './api.ts'
import type { StoredDevice } from '../types.ts'
import type { CallJoinPayload } from './call-media.ts'

type MembraneConnectMetadata = {
  call_id: string
  device_id: string
  mode: CallSession['mode']
  source: 'web-client'
  username: string
}

export type BootstrapActiveCallTransportOptions<ClientType> = {
  currentCall: CallSession
  currentDevice: StoredDevice
  currentSessionToken: string
  turnCredentials: TurnCredentials | null
  shouldRefreshTurnCredentials: (turnCredentials: TurnCredentials | null) => boolean
  fetchTurnCredentials: (token: string, params: { ttl_seconds: number }) => Promise<{ turn: TurnCredentials }>
  callParticipants: CallParticipant[]
  isParticipantJoined: (participants: CallParticipant[], deviceId: string) => boolean
  buildJoinPayload: (call: CallSession, latestCallKey: null) => CallJoinPayload
  joinCallSession: (token: string, callId: string, payload: CallJoinPayload) => Promise<{
    participants: CallParticipant[]
    room: CallRoomState | null
  }>
  currentEndpoint: CallWebRtcEndpointState | null
  currentRoom: CallRoomState | null
  provisionCallWebRtcEndpoint: (token: string, callId: string) => Promise<{
    endpoint: CallWebRtcEndpointState
    room: CallRoomState | null
  }>
  ensureMembraneClient: () => ClientType
  configureMembraneTurnServers: (client: ClientType, turnCredentials: TurnCredentials | null) => void
  membraneClientConnected: boolean
  membraneConnectRequestedCallId: string | null
  connectMembraneClient: (client: ClientType, metadata: MembraneConnectMetadata) => void
}

export type BootstrapActiveCallTransportResult = {
  turnCredentials: TurnCredentials | null
  participants: CallParticipant[] | null
  room: CallRoomState | null
  endpoint: CallWebRtcEndpointState
  membraneConnectRequestedCallId: string | null
}

export async function bootstrapActiveCallTransport<ClientType>(
  options: BootstrapActiveCallTransportOptions<ClientType>
): Promise<BootstrapActiveCallTransportResult> {
  const {
    currentCall,
    currentDevice,
    currentSessionToken,
    turnCredentials,
    shouldRefreshTurnCredentials,
    fetchTurnCredentials,
    callParticipants,
    isParticipantJoined,
    buildJoinPayload,
    joinCallSession,
    currentEndpoint,
    currentRoom,
    provisionCallWebRtcEndpoint,
    ensureMembraneClient,
    configureMembraneTurnServers,
    membraneClientConnected,
    membraneConnectRequestedCallId,
    connectMembraneClient
  } = options

  let nextTurnCredentials = turnCredentials

  if (shouldRefreshTurnCredentials(nextTurnCredentials)) {
    const response = await fetchTurnCredentials(currentSessionToken, { ttl_seconds: 600 })
    nextTurnCredentials = response.turn
  }

  let nextParticipants: CallParticipant[] | null = null
  let nextRoom = currentRoom
  const joined = isParticipantJoined(callParticipants, currentDevice.deviceId)

  if (!joined) {
    const joinPayload = buildJoinPayload(currentCall, null)
    const joinResponse = await joinCallSession(currentSessionToken, currentCall.id, joinPayload)
    nextParticipants = joinResponse.participants
    nextRoom = joinResponse.room
  }

  const endpointResponse =
    currentEndpoint?.exists
      ? { endpoint: currentEndpoint, room: nextRoom }
      : await provisionCallWebRtcEndpoint(currentSessionToken, currentCall.id)

  const client = ensureMembraneClient()
  configureMembraneTurnServers(client, nextTurnCredentials)

  let nextMembraneConnectRequestedCallId = membraneConnectRequestedCallId

  if (!membraneClientConnected && membraneConnectRequestedCallId !== currentCall.id) {
    nextMembraneConnectRequestedCallId = currentCall.id
    connectMembraneClient(client, {
      call_id: currentCall.id,
      device_id: currentDevice.deviceId,
      mode: currentCall.mode,
      source: 'web-client',
      username: currentDevice.username
    })
  }

  return {
    turnCredentials: nextTurnCredentials,
    participants: nextParticipants,
    room: endpointResponse.room ?? nextRoom,
    endpoint: endpointResponse.endpoint,
    membraneConnectRequestedCallId: nextMembraneConnectRequestedCallId
  }
}

export async function syncMembraneWebRtcQueue(
  token: string,
  callId: string,
  pollCallWebRtcMediaEvents: (token: string, callId: string) => Promise<{
    endpoint: CallWebRtcEndpointState
    media_events: string[]
  }>
): Promise<{
  endpoint: CallWebRtcEndpointState
  mediaEvents: string[]
}> {
  const response = await pollCallWebRtcMediaEvents(token, callId)
  return {
    endpoint: response.endpoint,
    mediaEvents: response.media_events
  }
}

export async function attachLocalTracks<ClientType>(
  membraneClient: ClientType,
  localStream: MediaStream,
  attachLocalTracksToMembrane: (client: ClientType, stream: MediaStream) => Promise<string[]>
): Promise<string[]> {
  return attachLocalTracksToMembrane(membraneClient, localStream)
}
