import type {
  CallParticipant,
  CallRoom,
  CallRoomMember,
  CallRoomState,
  CallSession,
  CallWebRtcEndpointState
} from './api.ts'
import type { MergedChatSummary } from './multi-server.ts'
import type { CallJoinPayload } from './call-media.ts'
import { preferredTrackKind } from './call-media.ts'
import type { BootstrapActiveCallTransportResult } from './call-orchestration.ts'

export async function startChatCallSession(
  sessionToken: string,
  rawChatId: string,
  activeChatId: string,
  activeChatSummary: MergedChatSummary | null,
  requestedMode: 'voice' | 'video' | 'group',
  createCallSession: (
    token: string,
    rawChatId: string,
    payload: { mode: 'voice' | 'video' | 'group'; media_mode?: 'voice' | 'video' }
  ) => Promise<{ call: CallSession }>
): Promise<{
  call: CallSession
  activeCallChatId: string
  displayTitle: string | null
  message: string
}> {
  const shouldStartGroupCall = activeChatSummary?.type === 'group'
  const response = await createCallSession(
    sessionToken,
    rawChatId,
    shouldStartGroupCall
      ? { mode: 'group', media_mode: requestedMode === 'group' ? 'voice' : requestedMode }
      : { mode: requestedMode }
  )

  const callStateLabel = response.call.status === 'ringing' ? 'ringing' : response.call.status

  return {
    call: response.call,
    activeCallChatId: activeChatId,
    displayTitle: activeChatSummary?.title ?? null,
    message: `${shouldStartGroupCall ? `${requestedMode} group` : requestedMode} call session is ${callStateLabel}.`
  }
}

export async function startAdHocCallSession(
  sessionToken: string,
  participantIds: string[],
  mediaMode: 'voice' | 'video',
  title: string | undefined,
  createCallRoom: (
    token: string,
    payload: { title?: string; participant_user_ids: string[] }
  ) => Promise<{ room: CallRoom; members: CallRoomMember[] }>,
  createCallRoomSession: (
    token: string,
    roomId: string,
    payload: { media_mode: 'voice' | 'video' }
  ) => Promise<{ call: CallSession }>
): Promise<{
  call: CallSession
  room: CallRoom
  members: CallRoomMember[]
  displayTitle: string
  message: string
}> {
  const roomResponse = await createCallRoom(sessionToken, {
    title,
    participant_user_ids: participantIds
  })
  const callResponse = await createCallRoomSession(sessionToken, roomResponse.room.id, {
    media_mode: mediaMode
  })

  return {
    call: callResponse.call,
    room: roomResponse.room,
    members: roomResponse.members,
    displayTitle: roomResponse.room.title,
    message: `${mediaMode} group call room is ringing.`
  }
}

export async function joinExistingCallSession(options: {
  sessionToken: string
  activeCall: CallSession
  buildJoinPayload: (call: CallSession, latestCallKey: null) => CallJoinPayload
  joinCallSession: (token: string, callId: string, payload: CallJoinPayload) => Promise<{
    participants: CallParticipant[]
    room: CallRoomState | null
  }>
  fetchCallWebRtcEndpointState: (token: string, callId: string) => Promise<{
    endpoint: CallWebRtcEndpointState
    room: CallRoomState | null
  }>
}): Promise<
  | { blockedMessage: string }
  | {
      participants: CallParticipant[]
      room: CallRoomState | null
      endpoint: CallWebRtcEndpointState
      message: string
    }
> {
  const {
    sessionToken,
    activeCall,
    buildJoinPayload,
    joinCallSession,
    fetchCallWebRtcEndpointState
  } = options

  const joinPayload = buildJoinPayload(activeCall, null)
  const response = await joinCallSession(sessionToken, activeCall.id, joinPayload)
  const endpointResponse = await fetchCallWebRtcEndpointState(sessionToken, activeCall.id)

  return {
    participants: response.participants,
    room: endpointResponse.room ?? response.room,
    endpoint: endpointResponse.endpoint,
    message: `Joined the Membrane room as ${preferredTrackKind(activeCall).replace('_', '+')} and the device endpoint is ready.`
  }
}

export async function leaveExistingCallSession(
  sessionToken: string,
  activeCall: CallSession,
  leaveCallSession: (token: string, callId: string) => Promise<{
    participants: CallParticipant[]
    room: CallRoomState | null
  }>,
  fetchCallWebRtcEndpointState: (token: string, callId: string) => Promise<{
    endpoint: CallWebRtcEndpointState
    room: CallRoomState | null
  }>
): Promise<{
  participants: CallParticipant[]
  room: CallRoomState | null
  endpoint: CallWebRtcEndpointState
  message: string
}> {
  const response = await leaveCallSession(sessionToken, activeCall.id)
  const endpointResponse = await fetchCallWebRtcEndpointState(sessionToken, activeCall.id)

  return {
    participants: response.participants,
    room: endpointResponse.room ?? response.room,
    endpoint: endpointResponse.endpoint,
    message: 'Left the active Membrane room.'
  }
}

export function summarizeBootstrapSuccess(
  result: BootstrapActiveCallTransportResult
): {
  turnCredentials: BootstrapActiveCallTransportResult['turnCredentials']
  participants: BootstrapActiveCallTransportResult['participants']
  room: BootstrapActiveCallTransportResult['room']
  endpoint: BootstrapActiveCallTransportResult['endpoint']
  membraneConnectRequestedCallId: BootstrapActiveCallTransportResult['membraneConnectRequestedCallId']
  message: string
} {
  return {
    ...result,
    message: 'Native Membrane WebRTC client initialized and connected to the provisioned endpoint.'
  }
}
