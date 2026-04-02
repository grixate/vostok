import { buildApiRoot } from './api-request.ts'
import { readMembraneNativeEventType } from '../utils/call-helpers.ts'
import type {
  CallRoomState,
  CallSession,
  CallWebRtcEndpointState
} from './api.ts'

export async function acceptIncomingCall(
  sessionToken: string,
  activeCallId: string,
  acceptCallSession: (token: string, callId: string) => Promise<{ call: CallSession }>
): Promise<{ call: CallSession; message: string }> {
  const response = await acceptCallSession(sessionToken, activeCallId)
  return { call: response.call, message: 'Call accepted.' }
}

export async function declineIncomingCall(
  sessionToken: string,
  activeCallId: string,
  activeCallChatId: string | null,
  declineCallSession: (token: string, callId: string) => Promise<{ call: CallSession }>
): Promise<{
  call: CallSession | null
  activeCallChatId: string | null
  message: string
}> {
  const response = await declineCallSession(sessionToken, activeCallId)
  return {
    call: response.call.status === 'ended' ? null : response.call,
    activeCallChatId: response.call.status === 'ended' ? null : activeCallChatId,
    message: 'Call declined.'
  }
}

export async function endActiveCallSession(
  sessionToken: string,
  activeCallId: string,
  activeCallChatId: string | null,
  endCallSession: (token: string, callId: string) => Promise<{ call: CallSession }>
): Promise<{
  call: CallSession | null
  activeCallChatId: string | null
  message: string
}> {
  const response = await endCallSession(sessionToken, activeCallId)
  return {
    call: response.call.status === 'active' ? response.call : null,
    activeCallChatId: response.call.status === 'active' ? activeCallChatId : null,
    message: 'Call session ended.'
  }
}

export async function provisionManualWebRtcEndpoint(
  sessionToken: string,
  activeCallId: string,
  provisionCallWebRtcEndpoint: (token: string, callId: string) => Promise<{
    endpoint: CallWebRtcEndpointState
    room: CallRoomState | null
  }>
): Promise<{
  endpoint: CallWebRtcEndpointState
  room: CallRoomState | null
  message: string
}> {
  const response = await provisionCallWebRtcEndpoint(sessionToken, activeCallId)
  return {
    endpoint: response.endpoint,
    room: response.room,
    message: `Membrane WebRTC endpoint ready for ${response.endpoint.endpoint_id}.`
  }
}

export async function pollManualWebRtcEndpoint(
  sessionToken: string,
  activeCallId: string,
  syncCallMembraneWebRtcQueue: (
    token: string,
    callId: string,
    pollCallWebRtcMediaEvents: (token: string, callId: string) => Promise<{
      endpoint: CallWebRtcEndpointState
      media_events: string[]
    }>
  ) => Promise<{ endpoint: CallWebRtcEndpointState; mediaEvents: string[] }>,
  pollCallWebRtcMediaEvents: (token: string, callId: string) => Promise<{
    endpoint: CallWebRtcEndpointState
    media_events: string[]
  }>
): Promise<{
  endpoint: CallWebRtcEndpointState
  mediaEvents: string[]
  message: string
}> {
  const response = await syncCallMembraneWebRtcQueue(
    sessionToken,
    activeCallId,
    pollCallWebRtcMediaEvents
  )

  const nativeEventCount = response.mediaEvents.reduce((count, eventPayload) => {
    return readMembraneNativeEventType(eventPayload) === null ? count : count + 1
  }, 0)

  return {
    endpoint: response.endpoint,
    mediaEvents: response.mediaEvents,
    message:
      response.mediaEvents.length > 0
        ? nativeEventCount > 0
          ? `Polled ${response.mediaEvents.length} outbound Membrane media event${response.mediaEvents.length === 1 ? '' : 's'}, including ${nativeEventCount} native protocol event${nativeEventCount === 1 ? '' : 's'}.`
          : `Polled ${response.mediaEvents.length} outbound Membrane media event${response.mediaEvents.length === 1 ? '' : 's'}.`
        : 'Membrane WebRTC endpoint has no queued outbound media events.'
  }
}

export function buildEndpointPingMetadata(call: CallSession): {
  pinged_at: string
  source: 'web-client'
  mode: CallSession['mode']
} {
  return {
    pinged_at: new Date().toISOString(),
    source: 'web-client',
    mode: call.mode
  }
}

export async function performUnloadCallCleanup(
  stream: MediaStream | null,
  stopLocalMediaStream: (stream: MediaStream | null) => void,
  activeCall: CallSession | null,
  sessionToken: string | null,
  activeCallApiBaseUrl: string,
  fetchImpl: typeof fetch
) {
  stopLocalMediaStream(stream)

  if (!activeCall || !sessionToken) {
    return
  }

  const apiRoot = buildApiRoot(activeCallApiBaseUrl)
  const url = `${apiRoot}/calls/${activeCall.id}/end`
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${sessionToken}`
  }
  await fetchImpl(url, { method: 'POST', headers, body: '{}', keepalive: true })
}
