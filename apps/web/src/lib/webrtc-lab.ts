import type { TurnCredentials } from './api'

export type WebRtcLabHandlers = {
  onIceCandidate?: (payload: string) => void
  onConnectionStateChange?: (connectionState: RTCPeerConnectionState) => void
  onSignalingStateChange?: (signalingState: RTCSignalingState) => void
  onRemoteDescriptionChange?: (payload: string | null) => void
  onLocalDescriptionChange?: (payload: string | null) => void
  onRemoteTrackCountsChange?: (payload: { audio: number; video: number }) => void
}

export function createWebRtcLab(
  turnCredentials: TurnCredentials | null,
  handlers: WebRtcLabHandlers
): RTCPeerConnection {
  const peer = new RTCPeerConnection({
    iceServers: turnCredentials
      ? [
          {
            urls: turnCredentials.uris,
            username: turnCredentials.username,
            credential: turnCredentials.password
          }
        ]
      : []
  })

  peer.createDataChannel('vostok-control')

  peer.onicecandidate = (event) => {
    if (!event.candidate) {
      return
    }

    handlers.onIceCandidate?.(JSON.stringify(event.candidate.toJSON()))
  }

  peer.onconnectionstatechange = () => {
    handlers.onConnectionStateChange?.(peer.connectionState)
  }

  peer.onsignalingstatechange = () => {
    handlers.onSignalingStateChange?.(peer.signalingState)
  }

  peer.oniceconnectionstatechange = () => {
    handlers.onConnectionStateChange?.(peer.connectionState)
  }

  peer.ontrack = () => {
    handlers.onRemoteTrackCountsChange?.(countRemoteTracks(peer))
  }

  return peer
}

export async function createOfferPayload(peer: RTCPeerConnection): Promise<string> {
  const description = await peer.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  })
  await peer.setLocalDescription(description)

  const payload = serializeDescription(peer.localDescription)

  if (!payload) {
    throw new Error('The browser did not produce a local offer description.')
  }

  return payload
}

export async function applyRemoteOfferAndCreateAnswer(
  peer: RTCPeerConnection,
  payload: string
): Promise<string> {
  const description = parseDescription(payload)
  await peer.setRemoteDescription(description)
  const answer = await peer.createAnswer()
  await peer.setLocalDescription(answer)
  const answerPayload = serializeDescription(peer.localDescription)

  if (!answerPayload) {
    throw new Error('The browser did not produce a local answer description.')
  }

  return answerPayload
}

export async function applyRemoteAnswer(peer: RTCPeerConnection, payload: string): Promise<void> {
  const description = parseDescription(payload)
  await peer.setRemoteDescription(description)
}

export async function applyRemoteIceCandidate(
  peer: RTCPeerConnection,
  payload: string
): Promise<void> {
  const candidate = parseIceCandidate(payload)
  await peer.addIceCandidate(candidate)
}

export function closeWebRtcLab(peer: RTCPeerConnection | null): void {
  if (!peer) {
    return
  }

  peer.onicecandidate = null
  peer.onconnectionstatechange = null
  peer.onsignalingstatechange = null
  peer.oniceconnectionstatechange = null
  peer.ontrack = null
  peer.close()
}

export async function attachLocalMediaTracks(
  peer: RTCPeerConnection,
  constraints: MediaStreamConstraints,
  previousStream: MediaStream | null
): Promise<{
  stream: MediaStream
  audioTrackCount: number
  videoTrackCount: number
}> {
  detachLocalMediaTracks(peer, previousStream)

  const stream = await navigator.mediaDevices.getUserMedia(constraints)

  for (const track of stream.getTracks()) {
    peer.addTrack(track, stream)
  }

  return {
    stream,
    audioTrackCount: stream.getAudioTracks().length,
    videoTrackCount: stream.getVideoTracks().length
  }
}

export function detachLocalMediaTracks(
  peer: RTCPeerConnection | null,
  stream: MediaStream | null
): void {
  if (peer) {
    for (const sender of peer.getSenders()) {
      if (sender.track && (sender.track.kind === 'audio' || sender.track.kind === 'video')) {
        peer.removeTrack(sender)
      }
    }
  }

  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop()
    }
  }
}

export function readDescriptionPayload(peer: RTCPeerConnection): string | null {
  return serializeDescription(peer.localDescription)
}

export function readRemoteDescriptionPayload(peer: RTCPeerConnection): string | null {
  return serializeDescription(peer.remoteDescription)
}

function serializeDescription(description: RTCSessionDescriptionInit | null): string | null {
  if (!description?.type || !description.sdp) {
    return null
  }

  return JSON.stringify({
    type: description.type,
    sdp: description.sdp
  })
}

function parseDescription(payload: string): RTCSessionDescriptionInit {
  const parsed = JSON.parse(payload) as {
    type?: RTCSdpType
    sdp?: string
  }

  if (!parsed.type || typeof parsed.sdp !== 'string') {
    throw new Error('Signal payload does not contain a valid session description.')
  }

  return {
    type: parsed.type,
    sdp: parsed.sdp
  }
}

function parseIceCandidate(payload: string): RTCIceCandidateInit {
  const parsed = JSON.parse(payload) as RTCIceCandidateInit

  if (!parsed || typeof parsed.candidate !== 'string') {
    throw new Error('Signal payload does not contain a valid ICE candidate.')
  }

  return parsed
}

function countRemoteTracks(peer: RTCPeerConnection): { audio: number; video: number } {
  let audio = 0
  let video = 0

  for (const receiver of peer.getReceivers()) {
    if (!receiver.track) {
      continue
    }

    if (receiver.track.kind === 'audio') {
      audio += 1
    }

    if (receiver.track.kind === 'video') {
      video += 1
    }
  }

  return { audio, video }
}
