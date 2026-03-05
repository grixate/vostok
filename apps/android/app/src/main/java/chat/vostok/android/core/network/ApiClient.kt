package chat.vostok.android.core.network

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

class ApiClient(
    baseUrl: String,
    tokenProvider: () -> String?
) {
    private val service: ApiEndpoints

    init {
        val logger = HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC }
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenProvider))
            .addInterceptor(logger)
            .build()

        val moshi = Moshi.Builder()
            .addLast(KotlinJsonAdapterFactory())
            .build()

        service = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(ApiEndpoints::class.java)
    }

    suspend fun health(): HealthResponse = service.health()

    suspend fun bootstrap(): BootstrapResponse = service.bootstrap()

    suspend fun register(request: RegisterRequest): RegistrationResponse = service.register(request)

    suspend fun challenge(deviceId: String): ChallengeResponse =
        service.challenge(ChallengeRequest(deviceId = deviceId))

    suspend fun verify(
        deviceId: String,
        challengeId: String,
        signatureBase64: String
    ): VerifyResponse =
        service.verify(
            VerifyChallengeRequest(
                deviceId = deviceId,
                challengeId = challengeId,
                signature = signatureBase64
            )
        )

    suspend fun me(): MeResponse = service.me()

    suspend fun publishPrekeys(request: PublishPrekeysRequest): PublishPrekeysResponse =
        service.publishPrekeys(request)

    suspend fun userPrekeys(username: String): UserPrekeysResponse = service.userPrekeys(username)

    suspend fun chats(): ChatsResponse = service.chats()

    suspend fun createDirectChat(username: String): ChatEnvelopeResponse =
        service.createDirectChat(CreateDirectChatRequest(username = username))

    suspend fun createGroupChat(title: String, members: List<String>): ChatEnvelopeResponse =
        service.createGroupChat(CreateGroupChatRequest(title = title, members = members))

    suspend fun renameGroupChat(chatId: String, title: String): ChatEnvelopeResponse =
        service.renameGroupChat(chatId, RenameGroupChatRequest(title = title))

    suspend fun groupMembers(chatId: String): GroupMembersResponse = service.groupMembers(chatId)

    suspend fun updateGroupMemberRole(chatId: String, userId: String, role: String): GroupMemberEnvelopeResponse =
        service.updateGroupMemberRole(chatId, userId, UpdateGroupMemberRoleRequest(role = role))

    suspend fun removeGroupMember(chatId: String, userId: String): GroupMemberEnvelopeResponse =
        service.removeGroupMember(chatId, userId)

    suspend fun safetyNumbers(chatId: String): SafetyNumbersResponse = service.safetyNumbers(chatId)

    suspend fun verifySafetyNumber(chatId: String, peerDeviceId: String): SafetyNumberEnvelopeResponse =
        service.verifySafetyNumber(chatId, peerDeviceId)

    suspend fun messages(chatId: String): MessagesResponse = service.messages(chatId)

    suspend fun recipientDevices(chatId: String): RecipientDevicesResponse =
        service.recipientDevices(chatId)

    suspend fun sessionBootstrap(chatId: String, peerDeviceId: String): SessionBootstrapResponse =
        service.sessionBootstrap(chatId, SessionBootstrapRequest(peerDeviceId))

    suspend fun sessionRekey(chatId: String, peerDeviceId: String): SessionBootstrapResponse =
        service.sessionRekey(chatId, SessionBootstrapRequest(peerDeviceId))

    suspend fun createMessage(chatId: String, request: CreateMessageRequest): MessageResponse =
        service.createMessage(chatId, request)

    suspend fun updateMessage(chatId: String, messageId: String, request: UpdateMessageRequest): MessageResponse =
        service.updateMessage(chatId, messageId, request)

    suspend fun deleteMessage(chatId: String, messageId: String): MessageResponse =
        service.deleteMessage(chatId, messageId)

    suspend fun togglePin(chatId: String, messageId: String): MessageResponse =
        service.togglePin(chatId, messageId)

    suspend fun toggleReaction(chatId: String, messageId: String, reactionKey: String): MessageResponse =
        service.toggleReaction(chatId, messageId, ToggleReactionRequest(reactionKey = reactionKey))

    suspend fun createMediaUpload(
        mediaKind: String,
        filename: String,
        contentType: String,
        declaredByteSize: Int,
        expectedPartCount: Int?
    ): MediaUploadEnvelopeResponse =
        service.createMediaUpload(
            CreateUploadRequest(
                mediaKind = mediaKind,
                filename = filename,
                contentType = contentType,
                declaredByteSize = declaredByteSize,
                expectedPartCount = expectedPartCount
            )
        )

    suspend fun mediaUploadStatus(uploadId: String): MediaUploadEnvelopeResponse =
        service.mediaUploadStatus(uploadId)

    suspend fun uploadMediaPart(
        uploadId: String,
        chunkBase64: String,
        partIndex: Int?,
        partCount: Int?
    ): MediaUploadEnvelopeResponse =
        service.uploadMediaPart(
            uploadId,
            UploadPartRequest(
                chunk = chunkBase64,
                partIndex = partIndex,
                partCount = partCount
            )
        )

    suspend fun completeMediaUpload(
        uploadId: String,
        ciphertextSha256: String?
    ): MediaUploadEnvelopeResponse =
        service.completeMediaUpload(uploadId, CompleteUploadRequest(ciphertextSha256 = ciphertextSha256))

    suspend fun mediaById(uploadId: String): MediaUploadEnvelopeResponse =
        service.mediaById(uploadId)

    suspend fun linkMetadata(url: String): LinkMetadataResponse =
        service.linkMetadata(LinkMetadataRequest(url = url))

    suspend fun devices(): DevicesResponse = service.devices()

    suspend fun revokeDevice(deviceId: String): DeviceEnvelopeResponse = service.revokeDevice(deviceId)

    suspend fun activeCall(chatId: String): ActiveCallResponse = service.activeCall(chatId)

    suspend fun createCall(chatId: String, mode: String): CallEnvelopeResponse =
        service.createCall(chatId, CreateCallRequest(mode = mode))

    suspend fun callState(callId: String): CallStateResponse = service.callState(callId)

    suspend fun joinCall(
        callId: String,
        trackKind: String,
        e2eeCapable: Boolean? = null,
        e2eeAlgorithm: String? = null,
        e2eeKeyEpoch: Int? = null
    ): JoinCallResponse =
        service.joinCall(
            callId,
            JoinCallRequest(
                trackKind = trackKind,
                e2eeCapable = e2eeCapable,
                e2eeAlgorithm = e2eeAlgorithm,
                e2eeKeyEpoch = e2eeKeyEpoch
            )
        )

    suspend fun callSignals(callId: String): SignalsResponse = service.callSignals(callId)

    suspend fun emitCallSignal(
        callId: String,
        signalType: String,
        payload: String,
        targetDeviceId: String? = null
    ): SignalEnvelopeResponse =
        service.emitCallSignal(
            callId,
            EmitSignalRequest(
                signalType = signalType,
                payload = payload,
                targetDeviceId = targetDeviceId
            )
        )

    suspend fun callKeys(callId: String): CallKeysResponse = service.callKeys(callId)

    suspend fun rotateCallKeys(
        callId: String,
        keyEpoch: Int,
        algorithm: String,
        wrappedKeys: Map<String, String>
    ): CallKeysResponse =
        service.rotateCallKeys(
            callId,
            RotateCallKeysRequest(
                keyEpoch = keyEpoch,
                algorithm = algorithm,
                wrappedKeys = wrappedKeys
            )
        )

    suspend fun provisionWebRtcEndpoint(callId: String): WebRtcEndpointResponse =
        service.provisionWebRtcEndpoint(callId)

    suspend fun webRtcEndpointState(callId: String): WebRtcEndpointResponse =
        service.webRtcEndpointState(callId)

    suspend fun pollWebRtcEndpoint(callId: String): WebRtcPollResponse =
        service.pollWebRtcEndpoint(callId)

    suspend fun leaveCall(callId: String): JoinCallResponse = service.leaveCall(callId)

    suspend fun endCall(callId: String): CallEnvelopeResponse = service.endCall(callId)

    suspend fun turnCredentials(ttlSeconds: Int = 3600): TurnCredentialsResponse =
        service.turnCredentials(TurnCredentialsRequest(ttlSeconds = ttlSeconds))
}
