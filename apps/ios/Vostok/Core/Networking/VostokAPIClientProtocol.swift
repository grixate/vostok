import Foundation

protocol VostokAPIClientProtocol {
    func health() async throws -> HealthResponse
    func apiHealth() async throws -> HealthResponse
    func bootstrap() async throws -> BootstrapResponse
    func ingestFederationDelivery(request: FederationDeliveryRequest) async throws -> FederationDeliveryResponse
    func acceptFederationPeerInvite(request: FederationPeerInviteAcceptRequest) async throws -> FederationPeerResponse

    func register(request: RegisterRequest) async throws -> RegistrationResponse
    func challenge(deviceID: String) async throws -> ChallengeResponse
    func verify(request: VerifyRequest) async throws -> VerifyResponse
    func users(token: String) async throws -> UsersResponse
    func me(token: String) async throws -> MeResponse

    func linkDevice(token: String, request: LinkDeviceRequest) async throws -> DeviceLinkResponse
    func devices(token: String) async throws -> DevicesResponse
    func revokeDevice(token: String, deviceID: String) async throws -> DevicesResponse

    func publishPrekeys(token: String, request: PublishPrekeysRequest) async throws -> PrekeyPublishResponse
    func prekeys(token: String, username: String) async throws -> PrekeyLookupResponse

    func chats(token: String) async throws -> ChatsResponse
    func createDirectChat(token: String, username: String) async throws -> ChatResponse
    func createSelfChat(token: String) async throws -> ChatResponse
    func createGroup(token: String, request: CreateGroupRequest) async throws -> ChatResponse
    func updateGroup(token: String, chatID: String, title: String) async throws -> ChatResponse
    func groupMembers(token: String, chatID: String) async throws -> GroupMembersResponse
    func updateGroupMember(token: String, chatID: String, userID: String, request: UpdateGroupMemberRequest) async throws -> GroupMemberResponse
    func removeGroupMember(token: String, chatID: String, userID: String) async throws -> GroupMemberResponse

    func recipientDevices(token: String, chatID: String) async throws -> RecipientDevicesResponse
    func messages(token: String, chatID: String) async throws -> MessagesResponse
    func markChatRead(token: String, chatID: String, lastReadMessageID: String?) async throws -> ChatReadStateResponse
    func createMessage(token: String, chatID: String, request: CreateMessageRequest) async throws -> MessageResponse
    func editMessage(token: String, chatID: String, messageID: String, request: EditMessageRequest) async throws -> MessageResponse
    func deleteMessage(token: String, chatID: String, messageID: String) async throws -> MessageResponse
    func togglePin(token: String, chatID: String, messageID: String) async throws -> MessageResponse
    func toggleReaction(token: String, chatID: String, messageID: String, reactionKey: String) async throws -> MessageResponse

    func senderKeys(token: String, chatID: String) async throws -> SenderKeysResponse
    func distributeSenderKeys(token: String, chatID: String, request: DistributeSenderKeysRequest) async throws -> SenderKeysResponse
    func sessionBootstrap(token: String, chatID: String, request: SessionBootstrapRequest) async throws -> SessionBootstrapResponse
    func sessionRekey(token: String, chatID: String, request: SessionRekeyRequest) async throws -> SessionBootstrapResponse
    func safetyNumbers(token: String, chatID: String) async throws -> SafetyNumbersResponse
    func verifySafetyNumber(token: String, chatID: String, peerDeviceID: String) async throws -> SafetyNumberDTO

    func createUpload(token: String, request: CreateUploadRequest) async throws -> UploadResponse
    func uploadPart(token: String, id: String, request: UploadPartRequest) async throws -> UploadResponse
    func uploadStatus(token: String, id: String) async throws -> UploadResponse
    func completeUpload(token: String, id: String, request: CompleteUploadRequest) async throws -> UploadResponse
    func media(token: String, id: String) async throws -> UploadResponse
    func linkMetadata(token: String, request: LinkMetadataRequest) async throws -> LinkMetadataResponse
    func adminOverview(token: String) async throws -> AdminOverviewResponse
    func federationPeers(token: String) async throws -> FederationPeersResponse
    func createFederationPeer(token: String, request: CreateFederationPeerRequest) async throws -> FederationPeerResponse
    func federationDeliveries(token: String) async throws -> FederationDeliveriesResponse
    func createFederationDelivery(token: String, peerID: String, request: CreateFederationDeliveryRequest) async throws -> FederationDeliveryResponse
    func attemptFederationDelivery(token: String, jobID: String, request: AttemptFederationDeliveryRequest) async throws -> FederationDeliveryResponse
    func updateFederationPeerStatus(token: String, peerID: String, request: UpdateFederationPeerStatusRequest) async throws -> FederationPeerResponse
    func federationPeerHeartbeat(token: String, peerID: String) async throws -> FederationPeerResponse
    func createFederationPeerInvite(token: String, peerID: String) async throws -> FederationPeerInviteResponse

    func createCall(token: String, chatID: String, mode: String) async throws -> CallResponse
    func activeCall(token: String, chatID: String) async throws -> CallResponse
    func callState(token: String, callID: String) async throws -> CallResponse
    func joinCall(token: String, callID: String, request: JoinCallRequest) async throws -> CallResponse
    func callKeys(token: String, callID: String) async throws -> CallKeysResponse
    func rotateCallKeys(token: String, callID: String, request: RotateCallKeysRequest) async throws -> CallKeysResponse
    func provisionEndpoint(token: String, callID: String, request: ProvisionWebRTCEndpointRequest) async throws -> WebRTCEndpointResponse
    func callSignals(token: String, callID: String) async throws -> CallSignalsResponse
    func emitSignal(token: String, callID: String, request: EmitSignalRequest) async throws -> CallSignalDTO
    func endpointState(token: String, callID: String) async throws -> WebRTCEndpointResponse
    func pushEndpointMediaEvent(token: String, callID: String, request: PushWebRTCMediaEventRequest) async throws -> WebRTCEndpointResponse
    func pollEndpoint(token: String, callID: String) async throws -> WebRTCEndpointResponse
    func leaveCall(token: String, callID: String) async throws -> CallResponse
    func endCall(token: String, callID: String) async throws -> CallResponse
    func turnCredentials(token: String) async throws -> TurnCredentialsResponse
}

struct FederationDeliveryRequest: Codable {
    let sourcePeerID: String?
    let payload: [String: JSONValue]?
    let eventType: String?
    let remoteDeliveryID: String?

    enum CodingKeys: String, CodingKey {
        case sourcePeerID = "source_peer_id"
        case payload
        case eventType = "event_type"
        case remoteDeliveryID = "remote_delivery_id"
    }
}

struct FederationPeerInviteAcceptRequest: Codable {
    let domain: String?
    let inviteToken: String

    enum CodingKeys: String, CodingKey {
        case domain
        case inviteToken = "invite_token"
    }
}

struct RegisterRequest: Codable {
    let username: String
    let deviceName: String
    let deviceIdentityPublicKey: String
    let deviceEncryptionPublicKey: String
    let signedPrekey: String
    let signedPrekeySignature: String
    let oneTimePrekeys: [String]

    enum CodingKeys: String, CodingKey {
        case username
        case deviceName = "device_name"
        case deviceIdentityPublicKey = "device_identity_public_key"
        case deviceEncryptionPublicKey = "device_encryption_public_key"
        case signedPrekey = "signed_prekey"
        case signedPrekeySignature = "signed_prekey_signature"
        case oneTimePrekeys = "one_time_prekeys"
    }
}

struct VerifyRequest: Codable {
    let deviceID: String
    let challengeID: String
    let signature: String

    enum CodingKeys: String, CodingKey {
        case deviceID = "device_id"
        case challengeID = "challenge_id"
        case signature
    }
}

struct PublishPrekeysRequest: Codable {
    let signedPrekey: String
    let signedPrekeySignature: String
    let oneTimePrekeys: [String]
    let replaceOneTimePrekeys: Bool

    enum CodingKeys: String, CodingKey {
        case signedPrekey = "signed_prekey"
        case signedPrekeySignature = "signed_prekey_signature"
        case oneTimePrekeys = "one_time_prekeys"
        case replaceOneTimePrekeys = "replace_one_time_prekeys"
    }
}

struct LinkDeviceRequest: Codable {
    let code: String
    let deviceName: String
    let deviceIdentityPublicKey: String
    let deviceEncryptionPublicKey: String
    let signedPrekey: String
    let signedPrekeySignature: String
    let oneTimePrekeys: [String]

    enum CodingKeys: String, CodingKey {
        case code
        case deviceName = "device_name"
        case deviceIdentityPublicKey = "device_identity_public_key"
        case deviceEncryptionPublicKey = "device_encryption_public_key"
        case signedPrekey = "signed_prekey"
        case signedPrekeySignature = "signed_prekey_signature"
        case oneTimePrekeys = "one_time_prekeys"
    }
}

struct CreateGroupRequest: Codable {
    let title: String
    let members: [String]
}

struct UpdateGroupMemberRequest: Codable {
    let role: String
}

struct CreateMessageRequest: Codable {
    let clientID: String
    let ciphertext: String
    let header: String
    let messageKind: String
    let recipientEnvelopes: [String: String]
    let establishedSessionIDs: [String]?
    let replyToMessageID: String?

    enum CodingKeys: String, CodingKey {
        case clientID = "client_id"
        case ciphertext
        case header
        case messageKind = "message_kind"
        case recipientEnvelopes = "recipient_envelopes"
        case establishedSessionIDs = "established_session_ids"
        case replyToMessageID = "reply_to_message_id"
    }
}

struct EditMessageRequest: Codable {
    let clientID: String
    let ciphertext: String
    let header: String
    let messageKind: String
    let recipientEnvelopes: [String: String]
    let replyToMessageID: String?

    enum CodingKeys: String, CodingKey {
        case clientID = "client_id"
        case ciphertext
        case header
        case messageKind = "message_kind"
        case recipientEnvelopes = "recipient_envelopes"
        case replyToMessageID = "reply_to_message_id"
    }
}

struct DistributeSenderKeysRequest: Codable {
    let keyID: String
    let senderKeyEpoch: Int
    let algorithm: String
    let recipientWrappedKeys: [String: String]

    enum CodingKeys: String, CodingKey {
        case keyID = "key_id"
        case senderKeyEpoch = "sender_key_epoch"
        case algorithm
        case recipientWrappedKeys = "recipient_wrapped_keys"
    }
}

struct SessionBootstrapRequest: Codable {
    let peerDeviceID: String?

    enum CodingKeys: String, CodingKey {
        case peerDeviceID = "peer_device_id"
    }
}

struct SessionRekeyRequest: Codable {
    let peerDeviceID: String?

    enum CodingKeys: String, CodingKey {
        case peerDeviceID = "peer_device_id"
    }
}

struct CreateUploadRequest: Codable {
    let filename: String
    let contentType: String
    let declaredByteSize: Int
    let mediaKind: String
    let expectedPartCount: Int?

    enum CodingKeys: String, CodingKey {
        case filename
        case contentType = "content_type"
        case declaredByteSize = "declared_byte_size"
        case mediaKind = "media_kind"
        case expectedPartCount = "expected_part_count"
    }
}

struct UploadPartRequest: Codable {
    let chunk: String
    let partIndex: Int?
    let partCount: Int?

    enum CodingKeys: String, CodingKey {
        case chunk
        case partIndex = "part_index"
        case partCount = "part_count"
    }
}

struct CompleteUploadRequest: Codable {
    let ciphertextSha256: String

    enum CodingKeys: String, CodingKey {
        case ciphertextSha256 = "ciphertext_sha256"
    }
}

struct LinkMetadataRequest: Codable {
    let url: String
}

struct CreateFederationPeerRequest: Codable {
    let domain: String
    let displayName: String?

    enum CodingKeys: String, CodingKey {
        case domain
        case displayName = "display_name"
    }
}

struct CreateFederationDeliveryRequest: Codable {
    let eventType: String?
    let payload: [String: JSONValue]?

    enum CodingKeys: String, CodingKey {
        case eventType = "event_type"
        case payload
    }
}

struct AttemptFederationDeliveryRequest: Codable {
    let outcome: String?
    let lastError: String?

    enum CodingKeys: String, CodingKey {
        case outcome
        case lastError = "last_error"
    }
}

struct UpdateFederationPeerStatusRequest: Codable {
    let status: String
}

struct JoinCallRequest: Codable {
    let trackKind: String
    let e2eeCapable: Bool?
    let e2eeAlgorithm: String?
    let e2eeKeyEpoch: Int?

    enum CodingKeys: String, CodingKey {
        case trackKind = "track_kind"
        case e2eeCapable = "e2ee_capable"
        case e2eeAlgorithm = "e2ee_algorithm"
        case e2eeKeyEpoch = "e2ee_key_epoch"
    }
}

struct EmitSignalRequest: Codable {
    let signalType: String
    let payload: String
    let targetDeviceID: String?

    enum CodingKeys: String, CodingKey {
        case signalType = "signal_type"
        case payload
        case targetDeviceID = "target_device_id"
    }
}

struct RotateCallKeysRequest: Codable {
    let keyEpoch: Int
    let keyMaterial: String
    let algorithm: String

    enum CodingKeys: String, CodingKey {
        case keyEpoch = "key_epoch"
        case keyMaterial = "key_material"
        case algorithm
    }
}

struct ProvisionWebRTCEndpointRequest: Codable {
    let endpointID: String?

    enum CodingKeys: String, CodingKey {
        case endpointID = "endpoint_id"
    }
}

struct PushWebRTCMediaEventRequest: Codable {
    let event: String
}
