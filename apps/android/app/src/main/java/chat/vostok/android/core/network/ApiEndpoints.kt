package chat.vostok.android.core.network

import com.squareup.moshi.Json
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PATCH
import retrofit2.http.Path

interface ApiEndpoints {
    @GET("/health")
    suspend fun health(): HealthResponse

    @GET("/api/v1/bootstrap")
    suspend fun bootstrap(): BootstrapResponse

    @POST("/api/v1/register")
    suspend fun register(@Body request: RegisterRequest): RegistrationResponse

    @POST("/api/v1/auth/challenge")
    suspend fun challenge(@Body request: ChallengeRequest): ChallengeResponse

    @POST("/api/v1/auth/verify")
    suspend fun verify(@Body request: VerifyChallengeRequest): VerifyResponse

    @GET("/api/v1/me")
    suspend fun me(): MeResponse

    @POST("/api/v1/devices/prekeys")
    suspend fun publishPrekeys(@Body request: PublishPrekeysRequest): PublishPrekeysResponse

    @GET("/api/v1/users/{username}/devices/prekeys")
    suspend fun userPrekeys(@Path("username") username: String): UserPrekeysResponse

    @GET("/api/v1/chats")
    suspend fun chats(): ChatsResponse

    @POST("/api/v1/chats/direct")
    suspend fun createDirectChat(@Body request: CreateDirectChatRequest): ChatEnvelopeResponse

    @POST("/api/v1/chats/group")
    suspend fun createGroupChat(@Body request: CreateGroupChatRequest): ChatEnvelopeResponse

    @PATCH("/api/v1/chats/{chat_id}/group")
    suspend fun renameGroupChat(
        @Path("chat_id") chatId: String,
        @Body request: RenameGroupChatRequest
    ): ChatEnvelopeResponse

    @GET("/api/v1/chats/{chat_id}/members")
    suspend fun groupMembers(@Path("chat_id") chatId: String): GroupMembersResponse

    @PATCH("/api/v1/chats/{chat_id}/members/{user_id}")
    suspend fun updateGroupMemberRole(
        @Path("chat_id") chatId: String,
        @Path("user_id") userId: String,
        @Body request: UpdateGroupMemberRoleRequest
    ): GroupMemberEnvelopeResponse

    @POST("/api/v1/chats/{chat_id}/members/{user_id}/remove")
    suspend fun removeGroupMember(
        @Path("chat_id") chatId: String,
        @Path("user_id") userId: String
    ): GroupMemberEnvelopeResponse

    @GET("/api/v1/chats/{chat_id}/safety-numbers")
    suspend fun safetyNumbers(@Path("chat_id") chatId: String): SafetyNumbersResponse

    @POST("/api/v1/chats/{chat_id}/safety-numbers/{peer_device_id}/verify")
    suspend fun verifySafetyNumber(
        @Path("chat_id") chatId: String,
        @Path("peer_device_id") peerDeviceId: String
    ): SafetyNumberEnvelopeResponse

    @GET("/api/v1/chats/{chat_id}/messages")
    suspend fun messages(@Path("chat_id") chatId: String): MessagesResponse

    @GET("/api/v1/chats/{chat_id}/recipient-devices")
    suspend fun recipientDevices(@Path("chat_id") chatId: String): RecipientDevicesResponse

    @POST("/api/v1/chats/{chat_id}/session-bootstrap")
    suspend fun sessionBootstrap(
        @Path("chat_id") chatId: String,
        @Body request: SessionBootstrapRequest
    ): SessionBootstrapResponse

    @POST("/api/v1/chats/{chat_id}/session-rekey")
    suspend fun sessionRekey(
        @Path("chat_id") chatId: String,
        @Body request: SessionBootstrapRequest
    ): SessionBootstrapResponse

    @POST("/api/v1/chats/{chat_id}/messages")
    suspend fun createMessage(
        @Path("chat_id") chatId: String,
        @Body request: CreateMessageRequest
    ): MessageResponse

    @PATCH("/api/v1/chats/{chat_id}/messages/{message_id}")
    suspend fun updateMessage(
        @Path("chat_id") chatId: String,
        @Path("message_id") messageId: String,
        @Body request: UpdateMessageRequest
    ): MessageResponse

    @POST("/api/v1/chats/{chat_id}/messages/{message_id}/delete")
    suspend fun deleteMessage(
        @Path("chat_id") chatId: String,
        @Path("message_id") messageId: String
    ): MessageResponse

    @POST("/api/v1/chats/{chat_id}/messages/{message_id}/pin")
    suspend fun togglePin(
        @Path("chat_id") chatId: String,
        @Path("message_id") messageId: String
    ): MessageResponse

    @POST("/api/v1/chats/{chat_id}/messages/{message_id}/reactions")
    suspend fun toggleReaction(
        @Path("chat_id") chatId: String,
        @Path("message_id") messageId: String,
        @Body request: ToggleReactionRequest
    ): MessageResponse

    @POST("/api/v1/media/uploads")
    suspend fun createMediaUpload(@Body request: CreateUploadRequest): MediaUploadEnvelopeResponse

    @GET("/api/v1/media/uploads/{id}")
    suspend fun mediaUploadStatus(@Path("id") uploadId: String): MediaUploadEnvelopeResponse

    @PATCH("/api/v1/media/uploads/{id}/part")
    suspend fun uploadMediaPart(
        @Path("id") uploadId: String,
        @Body request: UploadPartRequest
    ): MediaUploadEnvelopeResponse

    @POST("/api/v1/media/uploads/{id}/complete")
    suspend fun completeMediaUpload(
        @Path("id") uploadId: String,
        @Body request: CompleteUploadRequest
    ): MediaUploadEnvelopeResponse

    @GET("/api/v1/media/{id}")
    suspend fun mediaById(@Path("id") uploadId: String): MediaUploadEnvelopeResponse

    @POST("/api/v1/media/link-metadata")
    suspend fun linkMetadata(@Body request: LinkMetadataRequest): LinkMetadataResponse

    @GET("/api/v1/devices")
    suspend fun devices(): DevicesResponse

    @POST("/api/v1/devices/{device_id}/revoke")
    suspend fun revokeDevice(@Path("device_id") deviceId: String): DeviceEnvelopeResponse

    @GET("/api/v1/chats/{chat_id}/calls/active")
    suspend fun activeCall(@Path("chat_id") chatId: String): ActiveCallResponse

    @POST("/api/v1/chats/{chat_id}/calls")
    suspend fun createCall(
        @Path("chat_id") chatId: String,
        @Body request: CreateCallRequest
    ): CallEnvelopeResponse

    @GET("/api/v1/calls/{call_id}")
    suspend fun callState(@Path("call_id") callId: String): CallStateResponse

    @POST("/api/v1/calls/{call_id}/join")
    suspend fun joinCall(
        @Path("call_id") callId: String,
        @Body request: JoinCallRequest
    ): JoinCallResponse

    @GET("/api/v1/calls/{call_id}/signals")
    suspend fun callSignals(@Path("call_id") callId: String): SignalsResponse

    @POST("/api/v1/calls/{call_id}/signals")
    suspend fun emitCallSignal(
        @Path("call_id") callId: String,
        @Body request: EmitSignalRequest
    ): SignalEnvelopeResponse

    @GET("/api/v1/calls/{call_id}/keys")
    suspend fun callKeys(@Path("call_id") callId: String): CallKeysResponse

    @POST("/api/v1/calls/{call_id}/keys")
    suspend fun rotateCallKeys(
        @Path("call_id") callId: String,
        @Body request: RotateCallKeysRequest
    ): CallKeysResponse

    @POST("/api/v1/calls/{call_id}/webrtc-endpoint")
    suspend fun provisionWebRtcEndpoint(@Path("call_id") callId: String): WebRtcEndpointResponse

    @GET("/api/v1/calls/{call_id}/webrtc-endpoint")
    suspend fun webRtcEndpointState(@Path("call_id") callId: String): WebRtcEndpointResponse

    @POST("/api/v1/calls/{call_id}/webrtc-endpoint/poll")
    suspend fun pollWebRtcEndpoint(@Path("call_id") callId: String): WebRtcPollResponse

    @POST("/api/v1/calls/{call_id}/leave")
    suspend fun leaveCall(@Path("call_id") callId: String): JoinCallResponse

    @POST("/api/v1/calls/{call_id}/end")
    suspend fun endCall(@Path("call_id") callId: String): CallEnvelopeResponse

    @POST("/api/v1/calls/turn-credentials")
    suspend fun turnCredentials(@Body request: TurnCredentialsRequest): TurnCredentialsResponse
}

data class HealthResponse(val status: String)

data class BootstrapResponse(
    val status: String,
    val appVersion: String? = null
)

data class RegisterRequest(
    val username: String,
    @Json(name = "device_name") val deviceName: String,
    @Json(name = "device_identity_public_key") val deviceIdentityPublicKey: String,
    @Json(name = "encryption_public_key") val encryptionPublicKey: String,
    @Json(name = "signed_prekey") val signedPrekey: String,
    @Json(name = "signed_prekey_signature") val signedPrekeySignature: String,
    @Json(name = "one_time_prekeys") val oneTimePrekeys: List<String>
)

data class RegistrationResponse(
    val user: UserSummary,
    val device: DeviceSummary,
    val session: SessionPayload,
    @Json(name = "prekey_count") val prekeyCount: Int
)

data class ChallengeRequest(
    @Json(name = "device_id") val deviceId: String
)

data class ChallengeResponse(
    @Json(name = "device_id") val deviceId: String,
    @Json(name = "challenge_id") val challengeId: String,
    val challenge: String,
    val algorithm: String,
    @Json(name = "expires_at") val expiresAt: String
)

data class VerifyChallengeRequest(
    @Json(name = "device_id") val deviceId: String,
    @Json(name = "challenge_id") val challengeId: String,
    val signature: String
)

data class VerifyResponse(
    val session: SessionPayload
)

data class MeResponse(
    val user: UserSummary,
    val device: DeviceMe,
    val session: SessionExpiry
)

data class DeviceMe(
    val id: String,
    @Json(name = "device_name") val deviceName: String,
    val prekeys: PrekeyInventory?
)

data class SessionExpiry(
    @Json(name = "expires_at") val expiresAt: String
)

data class PrekeyInventory(
    @Json(name = "has_signed_prekey") val hasSignedPrekey: Boolean,
    @Json(name = "one_time_prekey_count") val oneTimePrekeyCount: Int
)

data class PublishPrekeysRequest(
    @Json(name = "signed_prekey") val signedPrekey: String,
    @Json(name = "signed_prekey_signature") val signedPrekeySignature: String,
    @Json(name = "one_time_prekeys") val oneTimePrekeys: List<String>,
    @Json(name = "replace_one_time_prekeys") val replaceOneTimePrekeys: Boolean = false
)

data class PublishPrekeysResponse(
    @Json(name = "device_id") val deviceId: String,
    @Json(name = "has_signed_prekey") val hasSignedPrekey: Boolean,
    @Json(name = "one_time_prekey_count") val oneTimePrekeyCount: Int
)

data class UserSummary(
    val id: String,
    val username: String
)

data class DeviceSummary(
    val id: String,
    @Json(name = "device_name") val deviceName: String
)

data class SessionPayload(
    val token: String,
    @Json(name = "expires_at") val expiresAt: String
)

data class UserPrekeysResponse(
    val user: PrekeyUserSummary,
    val devices: List<PrekeyBundleDto>
)

data class PrekeyUserSummary(
    val username: String,
    val id: String? = null
)

data class PrekeyBundleDto(
    @Json(name = "device_id") val deviceId: String,
    @Json(name = "user_id") val userId: String,
    @Json(name = "device_name") val deviceName: String,
    @Json(name = "identity_public_key") val identityPublicKey: String,
    @Json(name = "encryption_public_key") val encryptionPublicKey: String? = null,
    @Json(name = "signed_prekey") val signedPrekey: String? = null,
    @Json(name = "signed_prekey_signature") val signedPrekeySignature: String? = null,
    @Json(name = "one_time_prekey") val oneTimePrekey: String? = null
)

data class ChatDto(
    val id: String,
    val type: String,
    val title: String,
    @Json(name = "participant_usernames") val participantUsernames: List<String> = emptyList(),
    @Json(name = "is_self_chat") val isSelfChat: Boolean = false,
    @Json(name = "latest_message_at") val latestMessageAt: String? = null,
    @Json(name = "message_count") val messageCount: Int = 0
)

data class ChatEnvelopeResponse(
    val chat: ChatDto
)

data class ChatsResponse(
    val chats: List<ChatDto>
)

data class CreateDirectChatRequest(
    val username: String
)

data class CreateGroupChatRequest(
    val title: String,
    val members: List<String>
)

data class RenameGroupChatRequest(
    val title: String
)

data class GroupMemberDto(
    @Json(name = "user_id") val userId: String,
    val username: String,
    val role: String,
    @Json(name = "joined_at") val joinedAt: String? = null
)

data class GroupMembersResponse(
    val members: List<GroupMemberDto>
)

data class GroupMemberEnvelopeResponse(
    val member: GroupMemberDto
)

data class UpdateGroupMemberRoleRequest(
    val role: String
)

data class SafetyNumberDto(
    @Json(name = "chat_id") val chatId: String,
    @Json(name = "peer_device_id") val peerDeviceId: String,
    @Json(name = "peer_user_id") val peerUserId: String,
    @Json(name = "peer_username") val peerUsername: String,
    @Json(name = "peer_device_name") val peerDeviceName: String,
    val fingerprint: String,
    val verified: Boolean,
    @Json(name = "verified_at") val verifiedAt: String? = null
)

data class SafetyNumbersResponse(
    @Json(name = "safety_numbers") val safetyNumbers: List<SafetyNumberDto>
)

data class SafetyNumberEnvelopeResponse(
    @Json(name = "safety_number") val safetyNumber: SafetyNumberDto
)

data class ReactionDto(
    @Json(name = "reaction_key") val reactionKey: String,
    val count: Int,
    val reacted: Boolean
)

data class MessageDto(
    val id: String,
    @Json(name = "chat_id") val chatId: String,
    @Json(name = "client_id") val clientId: String? = null,
    @Json(name = "message_kind") val messageKind: String,
    @Json(name = "sender_device_id") val senderDeviceId: String,
    @Json(name = "inserted_at") val insertedAt: String,
    @Json(name = "pinned_at") val pinnedAt: String? = null,
    val header: String? = null,
    val ciphertext: String? = null,
    @Json(name = "reply_to_message_id") val replyToMessageId: String? = null,
    @Json(name = "edited_at") val editedAt: String? = null,
    @Json(name = "deleted_at") val deletedAt: String? = null,
    @Json(name = "recipient_device_ids") val recipientDeviceIds: List<String> = emptyList(),
    val reactions: List<ReactionDto> = emptyList()
)

data class MessagesResponse(
    val messages: List<MessageDto>
)

data class RecipientDeviceDto(
    @Json(name = "device_id") val deviceId: String,
    @Json(name = "user_id") val userId: String,
    @Json(name = "encryption_public_key") val encryptionPublicKey: String
)

data class RecipientDevicesResponse(
    @Json(name = "recipient_devices") val recipientDevices: List<RecipientDeviceDto>
)

data class SessionBootstrapRequest(
    @Json(name = "peer_device_id") val peerDeviceId: String
)

data class ChatSessionDto(
    val id: String,
    @Json(name = "chat_id") val chatId: String,
    val status: String,
    @Json(name = "recipient_device_id") val recipientDeviceId: String,
    @Json(name = "initiator_device_id") val initiatorDeviceId: String
)

data class SessionBootstrapResponse(
    val sessions: List<ChatSessionDto>
)

data class CreateMessageRequest(
    @Json(name = "client_id") val clientId: String,
    val ciphertext: String,
    val header: String,
    @Json(name = "message_kind") val messageKind: String,
    @Json(name = "recipient_envelopes") val recipientEnvelopes: Map<String, String>,
    @Json(name = "established_session_ids") val establishedSessionIds: List<String>? = null,
    @Json(name = "reply_to_message_id") val replyToMessageId: String? = null
)

data class UpdateMessageRequest(
    @Json(name = "client_id") val clientId: String? = null,
    val ciphertext: String,
    val header: String,
    @Json(name = "message_kind") val messageKind: String,
    @Json(name = "recipient_envelopes") val recipientEnvelopes: Map<String, String>,
    @Json(name = "established_session_ids") val establishedSessionIds: List<String>? = null,
    @Json(name = "reply_to_message_id") val replyToMessageId: String? = null
)

data class ToggleReactionRequest(
    @Json(name = "reaction_key") val reactionKey: String
)

data class MessageResponse(
    val message: MessageDto
)

data class CreateUploadRequest(
    @Json(name = "media_kind") val mediaKind: String,
    val filename: String,
    @Json(name = "content_type") val contentType: String,
    @Json(name = "declared_byte_size") val declaredByteSize: Int,
    @Json(name = "expected_part_count") val expectedPartCount: Int? = null
)

data class UploadPartRequest(
    val chunk: String,
    @Json(name = "part_index") val partIndex: Int? = null,
    @Json(name = "part_count") val partCount: Int? = null
)

data class CompleteUploadRequest(
    @Json(name = "ciphertext_sha256") val ciphertextSha256: String? = null
)

data class LinkMetadataRequest(
    val url: String
)

data class MediaUploadDto(
    val id: String,
    val status: String,
    @Json(name = "media_kind") val mediaKind: String,
    val filename: String,
    @Json(name = "content_type") val contentType: String,
    @Json(name = "declared_byte_size") val declaredByteSize: Int,
    @Json(name = "uploaded_byte_size") val uploadedByteSize: Int,
    @Json(name = "expected_part_count") val expectedPartCount: Int? = null,
    @Json(name = "uploaded_part_count") val uploadedPartCount: Int = 0,
    @Json(name = "uploaded_part_indexes") val uploadedPartIndexes: List<Int> = emptyList(),
    @Json(name = "ciphertext_sha256") val ciphertextSha256: String? = null,
    @Json(name = "completed_at") val completedAt: String? = null,
    val ciphertext: String? = null
)

data class MediaUploadEnvelopeResponse(
    val upload: MediaUploadDto
)

data class LinkMetadataDto(
    val url: String,
    val hostname: String? = null,
    val title: String? = null,
    val description: String? = null,
    @Json(name = "site_name") val siteName: String? = null,
    @Json(name = "canonical_url") val canonicalUrl: String? = null,
    @Json(name = "fetched_at") val fetchedAt: String? = null
)

data class LinkMetadataResponse(
    val metadata: LinkMetadataDto
)

data class DeviceDto(
    val id: String,
    @Json(name = "device_name") val deviceName: String,
    @Json(name = "is_current") val isCurrent: Boolean,
    @Json(name = "revoked_at") val revokedAt: String? = null,
    @Json(name = "last_active_at") val lastActiveAt: String? = null,
    @Json(name = "inserted_at") val insertedAt: String? = null,
    @Json(name = "one_time_prekey_count") val oneTimePrekeyCount: Int = 0
)

data class DevicesResponse(
    val devices: List<DeviceDto>
)

data class DeviceEnvelopeResponse(
    val device: DeviceDto
)

data class CallDto(
    val id: String,
    @Json(name = "chat_id") val chatId: String,
    @Json(name = "started_by_device_id") val startedByDeviceId: String,
    val mode: String,
    val status: String,
    @Json(name = "started_at") val startedAt: String? = null,
    @Json(name = "ended_at") val endedAt: String? = null
)

data class CallParticipantDto(
    val id: String,
    @Json(name = "call_id") val callId: String,
    @Json(name = "user_id") val userId: String,
    @Json(name = "device_id") val deviceId: String,
    val status: String,
    @Json(name = "track_kind") val trackKind: String,
    @Json(name = "e2ee_capable") val e2eeCapable: Boolean,
    @Json(name = "e2ee_algorithm") val e2eeAlgorithm: String? = null,
    @Json(name = "e2ee_key_epoch") val e2eeKeyEpoch: Int? = null,
    @Json(name = "joined_at") val joinedAt: String? = null,
    @Json(name = "left_at") val leftAt: String? = null
)

data class CallSignalDto(
    val id: String,
    @Json(name = "call_id") val callId: String,
    @Json(name = "from_device_id") val fromDeviceId: String,
    @Json(name = "target_device_id") val targetDeviceId: String? = null,
    @Json(name = "signal_type") val signalType: String,
    val payload: String,
    @Json(name = "inserted_at") val insertedAt: String? = null
)

data class CallKeyDto(
    val id: String,
    @Json(name = "call_id") val callId: String,
    @Json(name = "owner_device_id") val ownerDeviceId: String,
    @Json(name = "recipient_device_id") val recipientDeviceId: String,
    @Json(name = "key_epoch") val keyEpoch: Int,
    val algorithm: String,
    val status: String,
    @Json(name = "wrapped_key") val wrappedKey: String,
    @Json(name = "inserted_at") val insertedAt: String? = null,
    @Json(name = "updated_at") val updatedAt: String? = null
)

data class ActiveCallResponse(
    val call: CallDto?
)

data class CallEnvelopeResponse(
    val call: CallDto
)

data class CallStateResponse(
    val call: CallDto,
    val participants: List<CallParticipantDto> = emptyList(),
    val signals: List<CallSignalDto> = emptyList(),
    val room: Map<String, Any?>? = null
)

data class JoinCallResponse(
    val call: CallDto,
    val participant: CallParticipantDto? = null,
    val participants: List<CallParticipantDto> = emptyList(),
    val room: Map<String, Any?>? = null
)

data class SignalsResponse(
    val call: CallDto,
    val signals: List<CallSignalDto>
)

data class SignalEnvelopeResponse(
    val call: CallDto,
    val signal: CallSignalDto
)

data class CallKeysResponse(
    val call: CallDto,
    val keys: List<CallKeyDto>
)

data class WebRtcEndpointResponse(
    val call: CallDto,
    val endpoint: Map<String, Any?>? = null,
    val room: Map<String, Any?>? = null
)

data class WebRtcPollResponse(
    val call: CallDto,
    val endpoint: Map<String, Any?>? = null,
    @Json(name = "media_events") val mediaEvents: List<Map<String, Any?>> = emptyList()
)

data class CreateCallRequest(
    val mode: String
)

data class JoinCallRequest(
    @Json(name = "track_kind") val trackKind: String,
    @Json(name = "e2ee_capable") val e2eeCapable: Boolean? = null,
    @Json(name = "e2ee_algorithm") val e2eeAlgorithm: String? = null,
    @Json(name = "e2ee_key_epoch") val e2eeKeyEpoch: Int? = null
)

data class EmitSignalRequest(
    @Json(name = "signal_type") val signalType: String,
    val payload: String,
    @Json(name = "target_device_id") val targetDeviceId: String? = null
)

data class RotateCallKeysRequest(
    @Json(name = "key_epoch") val keyEpoch: Int,
    val algorithm: String,
    @Json(name = "wrapped_keys") val wrappedKeys: Map<String, String>
)

data class TurnCredentialsRequest(
    @Json(name = "ttl_seconds") val ttlSeconds: Int = 3600
)

data class TurnCredentialsResponse(
    val turn: TurnCredentials
)

data class TurnCredentials(
    val username: String,
    val password: String,
    @Json(name = "ttl_seconds") val ttlSeconds: Int,
    @Json(name = "expires_at") val expiresAt: String,
    val uris: List<String>
)
