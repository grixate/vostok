export type RegisterPayload = {
  username: string
  device_name: string
  device_identity_public_key: string
  device_encryption_public_key?: string
  signed_prekey?: string
  signed_prekey_signature?: string
  one_time_prekeys?: string[]
}

export type LinkDevicePayload = {
  device_name: string
  device_identity_public_key: string
  device_encryption_public_key: string
  signed_prekey: string
  signed_prekey_signature: string
  one_time_prekeys: string[]
}

export type MeResponse = {
  user: { id: string; username: string }
  device: {
    id: string
    device_name: string
    prekeys?: {
      device_id: string
      available_one_time_prekeys: number
      low_watermark: number
      target_count: number
      replenish_recommended: boolean
    } | null
  }
  session: { expires_at: string }
}

export type DeviceInfo = {
  id: string
  device_name: string
  is_current: boolean
  revoked_at: string | null
  last_active_at: string | null
  inserted_at: string | null
  one_time_prekey_count: number
}

export type SafetyNumberRecord = {
  chat_id: string
  peer_device_id: string
  peer_user_id: string
  peer_username: string
  peer_device_name: string
  fingerprint: string
  verified: boolean
  verified_at: string | null
}

export type ChatSummary = {
  id: string
  type: string
  title: string
  participant_usernames: string[]
  is_self_chat: boolean
  latest_message_at: string | null
  message_count: number
}

export type GroupMember = {
  user_id: string
  username: string
  role: 'admin' | 'member'
  joined_at: string | null
}

export type GroupSenderKey = {
  id: string
  chat_id: string
  owner_device_id: string
  recipient_device_id: string
  key_id: string
  sender_key_epoch: number
  algorithm: string
  status: 'active' | 'superseded'
  wrapped_sender_key: string
  inserted_at: string | null
  updated_at: string | null
}

export type ChatMessage = {
  id: string
  chat_id: string
  client_id: string
  message_kind: string
  crypto_scheme: string | null
  sender_key_id: string | null
  sender_key_epoch: number | null
  sender_device_id: string
  sender_username: string | null
  inserted_at: string
  pinned_at: string | null
  edited_at: string | null
  deleted_at: string | null
  header: string | null
  ciphertext: string
  reply_to_message_id: string | null
  recipient_device_ids: string[]
  reactions: Array<{
    reaction_key: string
    count: number
    reacted: boolean
  }>
  recipient_envelope: string | null
}

export type ChatDeviceSession = {
  id: string
  chat_id: string
  status: string
  established_at: string | null
  superseded_at: string | null
  establishment_state: 'pending_first_message' | 'established'
  session_state: 'active' | 'superseded'
  handshake_hash: string
  initiator_device_id: string
  recipient_device_id: string
  initiator_identity_public_key: string
  initiator_encryption_public_key: string
  initiator_ephemeral_public_key: string | null
  initiator_signed_prekey: string
  initiator_signed_prekey_signature: string
  recipient_identity_public_key: string
  recipient_encryption_public_key: string
  recipient_signed_prekey: string
  recipient_signed_prekey_signature: string
  recipient_one_time_prekey: string | null
}

export type RecipientDevice = {
  device_id: string
  user_id: string
  encryption_public_key: string
}

export type PrekeyDeviceBundle = {
  device_id: string
  user_id: string
  device_name: string
  identity_public_key: string
  encryption_public_key: string | null
  signed_prekey: string | null
  signed_prekey_signature: string | null
  one_time_prekey: string | null
}

export type MediaUpload = {
  id: string
  status: string
  media_kind: string
  filename: string
  content_type: string | null
  declared_byte_size: number
  uploaded_byte_size: number
  expected_part_count: number | null
  uploaded_part_count: number
  uploaded_part_indexes: number[]
  ciphertext_sha256: string | null
  completed_at: string | null
  ciphertext: string | null
}

export type LinkMetadata = {
  url: string
  hostname: string
  title: string
  description: string | null
  site_name: string | null
  canonical_url: string | null
  fetched_at: string
}

export type FederationPeer = {
  id: string
  domain: string
  display_name: string | null
  status: string
  trust_state: 'untrusted' | 'invited' | 'trusted' | 'revoked'
  last_error: string | null
  last_seen_at: string | null
  trusted_at: string | null
  inserted_at: string | null
  updated_at: string | null
}

export type FederationDeliveryJob = {
  id: string
  peer_id: string
  direction: string
  event_type: string
  status: string
  payload: Record<string, unknown>
  remote_delivery_id: string | null
  attempt_count: number
  available_at: string | null
  last_attempted_at: string | null
  delivered_at: string | null
  last_error: string | null
  inserted_at: string | null
  updated_at: string | null
}

export type AdminOverview = {
  users: number
  chats: number
  media_uploads: number
  federation_peers: number
  queued_federation_deliveries?: number
  pending_federation_peers: number
}

export type TurnCredentials = {
  username: string
  password: string
  ttl_seconds: number
  expires_at: string
  uris: string[]
}

export type CallSession = {
  id: string
  chat_id: string
  started_by_device_id: string
  mode: 'voice' | 'video' | 'group'
  status: 'active' | 'ended'
  started_at: string
  ended_at: string | null
}

export type CallParticipant = {
  id: string
  call_id: string
  user_id: string
  device_id: string
  status: 'joined' | 'left'
  track_kind: 'audio' | 'video' | 'audio_video'
  e2ee_capable: boolean
  e2ee_algorithm: string | null
  e2ee_key_epoch: number | null
  joined_at: string
  left_at: string | null
}

export type CallRoomState = {
  backend: string
  call_id: string
  mode: 'voice' | 'video' | 'group'
  participant_count: number
  active_device_ids: string[]
  endpoint_count?: number
  engine_pid?: string
  forwarded_track_count?: number
  track_count?: number
  webrtc_endpoint_count?: number
}

export type CallWebRtcEndpointState = {
  endpoint_id: string
  exists: boolean
  pending_media_event_count: number
}

export type CallSignal = {
  id: string
  call_id: string
  from_device_id: string
  target_device_id: string | null
  signal_type: 'offer' | 'answer' | 'ice' | 'renegotiate' | 'heartbeat'
  payload: string
  inserted_at: string
}

export type CallKeyDistribution = {
  id: string
  call_id: string
  owner_device_id: string
  recipient_device_id: string
  key_epoch: number
  algorithm: string
  status: 'active' | 'superseded'
  wrapped_key: string
  inserted_at: string | null
  updated_at: string | null
}

type ChallengeResponse = {
  challenge: string
  challenge_id: string
  expires_at: string
}

type SessionResponse = {
  token: string
  expires_at: string
}

export type RegisterResponse = {
  user: { id: string; username: string }
  device: { id: string; device_name: string }
  session: SessionResponse
  prekey_count: number
}

type ApiErrorBody = {
  error?: string
  message?: string
}

const API_ROOT = '/api/v1'

export async function registerDevice(payload: RegisterPayload): Promise<RegisterResponse> {
  return apiRequest<RegisterResponse>('/register', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export async function linkDevice(
  token: string,
  payload: LinkDevicePayload
): Promise<RegisterResponse> {
  return apiRequest<RegisterResponse>('/devices/link', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export async function issueChallenge(deviceId: string): Promise<ChallengeResponse> {
  return apiRequest<ChallengeResponse>('/auth/challenge', {
    method: 'POST',
    body: JSON.stringify({ device_id: deviceId })
  })
}

export async function verifyChallenge(
  deviceId: string,
  challengeId: string,
  signature: string
): Promise<{ session: SessionResponse }> {
  return apiRequest<{ session: SessionResponse }>('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({
      device_id: deviceId,
      challenge_id: challengeId,
      signature
    })
  })
}

export async function fetchMe(token: string): Promise<MeResponse> {
  return apiRequest<MeResponse>('/me', {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function listDevices(token: string): Promise<{ devices: DeviceInfo[] }> {
  return apiRequest<{ devices: DeviceInfo[] }>('/devices', {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function listUsers(token: string): Promise<{ users: { id: string; username: string }[] }> {
  return apiRequest<{ users: { id: string; username: string }[] }>('/users', {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function revokeDevice(
  token: string,
  deviceId: string
): Promise<{ device: DeviceInfo }> {
  return apiRequest<{ device: DeviceInfo }>(`/devices/${deviceId}/revoke`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({})
  })
}

export async function publishDevicePrekeys(
  token: string,
  payload: {
    signed_prekey?: string
    signed_prekey_signature?: string
    one_time_prekeys?: string[]
    replace_one_time_prekeys?: boolean
  }
): Promise<{
  device_id: string
  has_signed_prekey: boolean
  one_time_prekey_count: number
}> {
  return apiRequest<{
    device_id: string
    has_signed_prekey: boolean
    one_time_prekey_count: number
  }>('/devices/prekeys', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export async function fetchUserPrekeys(
  token: string,
  username: string
): Promise<{ user: { username: string }; devices: PrekeyDeviceBundle[] }> {
  return apiRequest<{ user: { username: string }; devices: PrekeyDeviceBundle[] }>(
    `/users/${encodeURIComponent(username)}/devices/prekeys`,
    {
      method: 'GET',
      headers: authHeader(token)
    }
  )
}

export async function listChats(token: string): Promise<{ chats: ChatSummary[] }> {
  return apiRequest<{ chats: ChatSummary[] }>('/chats', {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function createDirectChat(token: string, username: string): Promise<{ chat: ChatSummary }> {
  return apiRequest<{ chat: ChatSummary }>('/chats/direct', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ username })
  })
}

export async function createSelfChat(token: string): Promise<{ chat: ChatSummary }> {
  return apiRequest<{ chat: ChatSummary }>('/chats/self', {
    method: 'POST',
    headers: authHeader(token)
  })
}

export async function createGroupChat(
  token: string,
  payload: {
    title: string
    members?: string[]
  }
): Promise<{ chat: ChatSummary }> {
  return apiRequest<{ chat: ChatSummary }>('/chats/group', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export async function renameGroupChat(
  token: string,
  chatId: string,
  payload: {
    title: string
  }
): Promise<{ chat: ChatSummary }> {
  return apiRequest<{ chat: ChatSummary }>(`/chats/${chatId}/group`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export async function listGroupMembers(
  token: string,
  chatId: string
): Promise<{ members: GroupMember[] }> {
  return apiRequest<{ members: GroupMember[] }>(`/chats/${chatId}/members`, {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function updateGroupMemberRole(
  token: string,
  chatId: string,
  userId: string,
  role: 'admin' | 'member'
): Promise<{ member: GroupMember }> {
  return apiRequest<{ member: GroupMember }>(`/chats/${chatId}/members/${userId}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ role })
  })
}

export async function removeGroupMember(
  token: string,
  chatId: string,
  userId: string
): Promise<{ member: GroupMember }> {
  return apiRequest<{ member: GroupMember }>(`/chats/${chatId}/members/${userId}/remove`, {
    method: 'POST',
    headers: authHeader(token)
  })
}

export async function bootstrapChatSessions(
  token: string,
  chatId: string,
  payload?: {
    initiator_ephemeral_keys?: Record<string, string>
  }
): Promise<{ sessions: ChatDeviceSession[] }> {
  return apiRequest<{ sessions: ChatDeviceSession[] }>(`/chats/${chatId}/session-bootstrap`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload ?? {})
  })
}

export async function rekeyChatSessions(
  token: string,
  chatId: string,
  payload: {
    initiator_ephemeral_keys: Record<string, string>
  }
): Promise<{ sessions: ChatDeviceSession[] }> {
  return apiRequest<{ sessions: ChatDeviceSession[] }>(`/chats/${chatId}/session-rekey`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export async function listSafetyNumbers(
  token: string,
  chatId: string
): Promise<{ safety_numbers: SafetyNumberRecord[] }> {
  return apiRequest<{ safety_numbers: SafetyNumberRecord[] }>(`/chats/${chatId}/safety-numbers`, {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function verifySafetyNumber(
  token: string,
  chatId: string,
  peerDeviceId: string
): Promise<{ safety_number: SafetyNumberRecord }> {
  return apiRequest<{ safety_number: SafetyNumberRecord }>(
    `/chats/${chatId}/safety-numbers/${peerDeviceId}/verify`,
    {
      method: 'POST',
      headers: authHeader(token),
      body: JSON.stringify({})
    }
  )
}

export async function listGroupSenderKeys(
  token: string,
  chatId: string
): Promise<{ sender_keys: GroupSenderKey[] }> {
  return apiRequest<{ sender_keys: GroupSenderKey[] }>(`/chats/${chatId}/sender-keys`, {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function distributeGroupSenderKeys(
  token: string,
  chatId: string,
  payload: {
    key_id: string
    sender_key_epoch?: number
    algorithm?: string
    wrapped_keys: Record<string, string>
  }
): Promise<{ sender_keys: GroupSenderKey[] }> {
  return apiRequest<{ sender_keys: GroupSenderKey[] }>(`/chats/${chatId}/sender-keys`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export async function listMessages(token: string, chatId: string): Promise<{ messages: ChatMessage[] }> {
  return apiRequest<{ messages: ChatMessage[] }>(`/chats/${chatId}/messages`, {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function listRecipientDevices(
  token: string,
  chatId: string
): Promise<{ recipient_devices: RecipientDevice[] }> {
  return apiRequest<{ recipient_devices: RecipientDevice[] }>(`/chats/${chatId}/recipient-devices`, {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function createMessage(
  token: string,
  chatId: string,
  payload: {
    client_id: string
    ciphertext: string
    message_kind: string
    header?: string
    crypto_scheme?: string
    sender_key_id?: string
    sender_key_epoch?: number
    reply_to_message_id?: string
    recipient_envelopes?: Record<string, string>
    established_session_ids?: string[]
  }
): Promise<{ message: ChatMessage }> {
  return apiRequest<{ message: ChatMessage }>(`/chats/${chatId}/messages`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export async function updateMessage(
  token: string,
  chatId: string,
  messageId: string,
  payload: {
    client_id: string
    ciphertext: string
    message_kind: string
    header?: string
    crypto_scheme?: string
    sender_key_id?: string
    sender_key_epoch?: number
    reply_to_message_id?: string
    recipient_envelopes?: Record<string, string>
    established_session_ids?: string[]
  }
): Promise<{ message: ChatMessage }> {
  return apiRequest<{ message: ChatMessage }>(`/chats/${chatId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export async function deleteMessage(
  token: string,
  chatId: string,
  messageId: string
): Promise<{ message: ChatMessage }> {
  return apiRequest<{ message: ChatMessage }>(`/chats/${chatId}/messages/${messageId}/delete`, {
    method: 'POST',
    headers: authHeader(token)
  })
}

export async function toggleMessagePin(
  token: string,
  chatId: string,
  messageId: string
): Promise<{ message: ChatMessage }> {
  return apiRequest<{ message: ChatMessage }>(`/chats/${chatId}/messages/${messageId}/pin`, {
    method: 'POST',
    headers: authHeader(token)
  })
}

export async function toggleMessageReaction(
  token: string,
  chatId: string,
  messageId: string,
  reactionKey: string
): Promise<{ message: ChatMessage }> {
  return apiRequest<{ message: ChatMessage }>(`/chats/${chatId}/messages/${messageId}/reactions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ reaction_key: reactionKey })
  })
}

export async function createMediaUpload(
  token: string,
  payload: {
    filename: string
    content_type?: string
    declared_byte_size: number
    media_kind?: string
    expected_part_count?: number
  }
): Promise<{ upload: MediaUpload }> {
  return apiRequest<{ upload: MediaUpload }>('/media/uploads', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export async function appendMediaUploadPart(
  token: string,
  uploadId: string,
  payload: {
    chunk: string
    part_index?: number
    part_count?: number
  }
): Promise<{ upload: MediaUpload }> {
  return apiRequest<{ upload: MediaUpload }>(`/media/uploads/${uploadId}/part`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export async function completeMediaUpload(
  token: string,
  uploadId: string,
  payload?: { ciphertext_sha256?: string }
): Promise<{ upload: MediaUpload }> {
  return apiRequest<{ upload: MediaUpload }>(`/media/uploads/${uploadId}/complete`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload ?? {})
  })
}

export async function fetchMediaUploadState(
  token: string,
  uploadId: string
): Promise<{ upload: MediaUpload }> {
  return apiRequest<{ upload: MediaUpload }>(`/media/uploads/${uploadId}`, {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function fetchMediaUpload(token: string, uploadId: string): Promise<{ upload: MediaUpload }> {
  return apiRequest<{ upload: MediaUpload }>(`/media/${uploadId}`, {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function fetchMediaLinkMetadata(
  token: string,
  url: string
): Promise<{ metadata: LinkMetadata }> {
  return apiRequest<{ metadata: LinkMetadata }>('/media/link-metadata', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ url })
  })
}

export async function fetchAdminOverview(token: string): Promise<{ overview: AdminOverview }> {
  return apiRequest<{ overview: AdminOverview }>('/admin/overview', {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function listFederationDeliveries(
  token: string
): Promise<{ deliveries: FederationDeliveryJob[] }> {
  return apiRequest<{ deliveries: FederationDeliveryJob[] }>('/admin/federation/deliveries', {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function createFederationDelivery(
  token: string,
  peerId: string,
  payload?: {
    event_type?: string
    payload?: Record<string, unknown>
  }
): Promise<{ delivery: FederationDeliveryJob }> {
  return apiRequest<{ delivery: FederationDeliveryJob }>(`/admin/federation/peers/${peerId}/deliveries`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload ?? {})
  })
}

export async function attemptFederationDelivery(
  token: string,
  jobId: string,
  payload?: {
    outcome?: 'processing' | 'delivered' | 'failed'
    last_error?: string
  }
): Promise<{ delivery: FederationDeliveryJob }> {
  return apiRequest<{ delivery: FederationDeliveryJob }>(`/admin/federation/deliveries/${jobId}/attempt`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload ?? {})
  })
}

export async function listFederationPeers(token: string): Promise<{ peers: FederationPeer[] }> {
  return apiRequest<{ peers: FederationPeer[] }>('/admin/federation/peers', {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function createFederationPeer(
  token: string,
  payload: {
    domain: string
    display_name?: string
  }
): Promise<{ peer: FederationPeer }> {
  return apiRequest<{ peer: FederationPeer }>('/admin/federation/peers', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export async function updateFederationPeerStatus(
  token: string,
  peerId: string,
  status: 'pending' | 'active' | 'disabled'
): Promise<{ peer: FederationPeer }> {
  return apiRequest<{ peer: FederationPeer }>(`/admin/federation/peers/${peerId}/status`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ status })
  })
}

export async function recordFederationPeerHeartbeat(
  token: string,
  peerId: string
): Promise<{ peer: FederationPeer }> {
  return apiRequest<{ peer: FederationPeer }>(`/admin/federation/peers/${peerId}/heartbeat`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({})
  })
}

export async function createFederationPeerInvite(
  token: string,
  peerId: string
): Promise<{ peer: FederationPeer; invite_token: string }> {
  return apiRequest<{ peer: FederationPeer; invite_token: string }>(
    `/admin/federation/peers/${peerId}/invite`,
    {
      method: 'POST',
      headers: authHeader(token),
      body: JSON.stringify({})
    }
  )
}

export async function acceptFederationPeerInvite(payload: {
  domain: string
  invite_token: string
}): Promise<{ peer: FederationPeer }> {
  return apiRequest<{ peer: FederationPeer }>('/federation/peers/accept', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export async function fetchTurnCredentials(
  token: string,
  payload?: {
    ttl_seconds?: number
  }
): Promise<{ turn: TurnCredentials }> {
  return apiRequest<{ turn: TurnCredentials }>('/calls/turn-credentials', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload ?? {})
  })
}

export async function fetchActiveCall(
  token: string,
  chatId: string
): Promise<{ call: CallSession | null }> {
  return apiRequest<{ call: CallSession | null }>(`/chats/${chatId}/calls/active`, {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function fetchCallState(
  token: string,
  callId: string
): Promise<{
  call: CallSession
  participants: CallParticipant[]
  signals: CallSignal[]
  room: CallRoomState | null
}> {
  return apiRequest<{
    call: CallSession
    participants: CallParticipant[]
    signals: CallSignal[]
    room: CallRoomState | null
  }>(`/calls/${callId}`, {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function provisionCallWebRtcEndpoint(
  token: string,
  callId: string
): Promise<{
  call: CallSession
  endpoint: CallWebRtcEndpointState
  room: CallRoomState | null
}> {
  return apiRequest<{
    call: CallSession
    endpoint: CallWebRtcEndpointState
    room: CallRoomState | null
  }>(`/calls/${callId}/webrtc-endpoint`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({})
  })
}

export async function fetchCallWebRtcEndpointState(
  token: string,
  callId: string
): Promise<{
  call: CallSession
  endpoint: CallWebRtcEndpointState
  room: CallRoomState | null
}> {
  return apiRequest<{
    call: CallSession
    endpoint: CallWebRtcEndpointState
    room: CallRoomState | null
  }>(`/calls/${callId}/webrtc-endpoint`, {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function pushCallWebRtcMediaEvent(
  token: string,
  callId: string,
  event: string
): Promise<{
  call: CallSession
  endpoint: CallWebRtcEndpointState
  media_events: string[]
}> {
  return apiRequest<{
    call: CallSession
    endpoint: CallWebRtcEndpointState
    media_events: string[]
  }>(`/calls/${callId}/webrtc-endpoint/media-events`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ event })
  })
}

export async function pollCallWebRtcMediaEvents(
  token: string,
  callId: string
): Promise<{
  call: CallSession
  endpoint: CallWebRtcEndpointState
  media_events: string[]
}> {
  return apiRequest<{
    call: CallSession
    endpoint: CallWebRtcEndpointState
    media_events: string[]
  }>(`/calls/${callId}/webrtc-endpoint/poll`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({})
  })
}

export async function createCallSession(
  token: string,
  chatId: string,
  payload?: {
    mode?: 'voice' | 'video' | 'group'
  }
): Promise<{ call: CallSession }> {
  return apiRequest<{ call: CallSession }>(`/chats/${chatId}/calls`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload ?? {})
  })
}

export async function joinCallSession(
  token: string,
  callId: string,
  payload?: {
    track_kind?: 'audio' | 'video' | 'audio_video'
    e2ee_capable?: boolean
    e2ee_algorithm?: string
    e2ee_key_epoch?: number
  }
): Promise<{
  call: CallSession
  participant: CallParticipant
  participants: CallParticipant[]
  room: CallRoomState | null
}> {
  return apiRequest<{
    call: CallSession
    participant: CallParticipant
    participants: CallParticipant[]
    room: CallRoomState | null
  }>(`/calls/${callId}/join`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload ?? {})
  })
}

export async function fetchCallSignals(
  token: string,
  callId: string
): Promise<{
  call: CallSession
  signals: CallSignal[]
}> {
  return apiRequest<{
    call: CallSession
    signals: CallSignal[]
  }>(`/calls/${callId}/signals`, {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function sendCallSignal(
  token: string,
  callId: string,
  payload: {
    signal_type: 'offer' | 'answer' | 'ice' | 'renegotiate' | 'heartbeat'
    payload: string
    target_device_id?: string
  }
): Promise<{
  call: CallSession
  signal: CallSignal
}> {
  return apiRequest<{
    call: CallSession
    signal: CallSignal
  }>(`/calls/${callId}/signals`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export async function leaveCallSession(
  token: string,
  callId: string
): Promise<{
  call: CallSession
  participant: CallParticipant
  participants: CallParticipant[]
  room: CallRoomState | null
}> {
  return apiRequest<{
    call: CallSession
    participant: CallParticipant
    participants: CallParticipant[]
    room: CallRoomState | null
  }>(`/calls/${callId}/leave`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({})
  })
}

export async function endCallSession(token: string, callId: string): Promise<{ call: CallSession }> {
  return apiRequest<{ call: CallSession }>(`/calls/${callId}/end`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({})
  })
}

export async function fetchCallKeys(
  token: string,
  callId: string
): Promise<{
  call: CallSession
  keys: CallKeyDistribution[]
}> {
  return apiRequest<{
    call: CallSession
    keys: CallKeyDistribution[]
  }>(`/calls/${callId}/keys`, {
    method: 'GET',
    headers: authHeader(token)
  })
}

export async function rotateCallKeys(
  token: string,
  callId: string,
  payload: {
    key_epoch?: number
    algorithm?: string
    wrapped_keys: Record<string, string>
  }
): Promise<{
  call: CallSession
  keys: CallKeyDistribution[]
}> {
  return apiRequest<{
    call: CallSession
    keys: CallKeyDistribution[]
  }>(`/calls/${callId}/keys`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  })

  const data = (await response.json().catch(() => ({}))) as T & ApiErrorBody

  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? 'Request failed.')
  }

  return data
}

function authHeader(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`
  }
}
