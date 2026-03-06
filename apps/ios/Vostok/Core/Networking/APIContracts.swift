import Foundation

enum VostokAPIError: Error, LocalizedError {
    case invalidURL
    case invalidResponse
    case unauthorized(String)
    case notFound(String)
    case validation(String)
    case transport(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .invalidResponse: return "Invalid response"
        case let .unauthorized(message): return message
        case let .notFound(message): return message
        case let .validation(message): return message
        case let .transport(error): return error.localizedDescription
        }
    }
}

struct ErrorEnvelope: Codable {
    let error: String
    let message: String
}

enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value.")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value):
            try container.encode(value)
        case let .number(value):
            try container.encode(value)
        case let .bool(value):
            try container.encode(value)
        case let .object(value):
            try container.encode(value)
        case let .array(value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

struct GenericMessageResponse: Codable {
    let status: String?
    let message: String?
}

struct UserDTO: Codable, Equatable {
    let id: String
    let username: String
}

struct DeviceDTO: Codable, Equatable {
    let id: String
    let deviceName: String?

    enum CodingKeys: String, CodingKey {
        case id
        case deviceName = "device_name"
    }
}

struct DevicesResponse: Codable {
    let devices: [DeviceDTO]
}

struct DeviceLinkResponse: Codable {
    let user: UserDTO?
    let device: DeviceDTO
    let session: AuthSessionResponse?
}

struct AuthSessionResponse: Codable, Equatable {
    let token: String
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case token
        case expiresAt = "expires_at"
    }
}

struct RegistrationResponse: Codable {
    let user: UserDTO
    let device: DeviceDTO
    let session: AuthSessionResponse
    let prekeyCount: Int

    enum CodingKeys: String, CodingKey {
        case user, device, session
        case prekeyCount = "prekey_count"
    }
}

struct MeResponse: Codable {
    struct SessionDTO: Codable {
        let expiresAt: String
        enum CodingKeys: String, CodingKey { case expiresAt = "expires_at" }
    }

    let user: UserDTO
    let device: DeviceDTO
    let session: SessionDTO
}

struct ChallengeResponse: Codable {
    let challengeID: String
    let challenge: String

    enum CodingKeys: String, CodingKey {
        case challengeID = "challenge_id"
        case challenge
    }
}

struct VerifyResponse: Codable {
    let session: AuthSessionResponse
}

struct PrekeyPublishResponse: Codable {
    let deviceID: String
    let hasSignedPrekey: Bool
    let oneTimePrekeyCount: Int

    enum CodingKeys: String, CodingKey {
        case deviceID = "device_id"
        case hasSignedPrekey = "has_signed_prekey"
        case oneTimePrekeyCount = "one_time_prekey_count"
    }
}

struct PrekeyBundleDTO: Codable {
    let deviceID: String
    let identityPublicKey: String?
    let encryptionPublicKey: String?
    let signedPrekey: String?
    let signedPrekeySignature: String?
    let oneTimePrekey: String?

    enum CodingKeys: String, CodingKey {
        case deviceID = "device_id"
        case identityPublicKey = "identity_public_key"
        case encryptionPublicKey = "encryption_public_key"
        case signedPrekey = "signed_prekey"
        case signedPrekeySignature = "signed_prekey_signature"
        case oneTimePrekey = "one_time_prekey"
    }
}

struct PrekeyLookupResponse: Codable {
    let user: UserDTO
    let devices: [PrekeyBundleDTO]
}

struct ChatDTO: Codable, Equatable, Identifiable, Hashable {
    let id: String
    let type: String
    let title: String
    let participantUsernames: [String]
    let isSelfChat: Bool
    let latestMessageAt: String?
    let messageCount: Int

    enum CodingKeys: String, CodingKey {
        case id, type, title
        case participantUsernames = "participant_usernames"
        case isSelfChat = "is_self_chat"
        case latestMessageAt = "latest_message_at"
        case messageCount = "message_count"
    }
}

struct ChatsResponse: Codable {
    let chats: [ChatDTO]
}

struct ChatResponse: Codable {
    let chat: ChatDTO
}

struct ReactionDTO: Codable, Equatable {
    let reactionKey: String
    let count: Int
    let reacted: Bool

    enum CodingKeys: String, CodingKey {
        case reactionKey = "reaction_key"
        case count, reacted
    }
}

struct MessageDTO: Codable, Equatable, Identifiable {
    let id: String
    let chatID: String
    let clientID: String?
    let messageKind: String
    let senderDeviceID: String
    let insertedAt: String
    let pinnedAt: String?
    let header: String?
    let ciphertext: String?
    let replyToMessageID: String?
    let editedAt: String?
    let deletedAt: String?
    let recipientDeviceIDs: [String]
    let reactions: [ReactionDTO]
    let recipientEnvelope: String?

    enum CodingKeys: String, CodingKey {
        case id
        case chatID = "chat_id"
        case clientID = "client_id"
        case messageKind = "message_kind"
        case senderDeviceID = "sender_device_id"
        case insertedAt = "inserted_at"
        case pinnedAt = "pinned_at"
        case header, ciphertext
        case replyToMessageID = "reply_to_message_id"
        case editedAt = "edited_at"
        case deletedAt = "deleted_at"
        case recipientDeviceIDs = "recipient_device_ids"
        case reactions
        case recipientEnvelope = "recipient_envelope"
    }
}

struct MessagesResponse: Codable {
    let messages: [MessageDTO]
}

struct MarkChatReadRequest: Codable {
    let lastReadMessageID: String?

    enum CodingKeys: String, CodingKey {
        case lastReadMessageID = "last_read_message_id"
    }
}

struct ChatReadStateDTO: Codable, Equatable {
    let chatID: String
    let deviceID: String
    let lastReadMessageID: String?
    let readAt: String?

    enum CodingKeys: String, CodingKey {
        case chatID = "chat_id"
        case deviceID = "device_id"
        case lastReadMessageID = "last_read_message_id"
        case readAt = "read_at"
    }
}

struct ChatReadStateResponse: Codable {
    let readState: ChatReadStateDTO

    enum CodingKeys: String, CodingKey {
        case readState = "read_state"
    }
}

struct MessageResponse: Codable {
    let message: MessageDTO
}

struct RecipientDeviceDTO: Codable, Equatable {
    let deviceID: String
    let encryptionPublicKey: String

    enum CodingKeys: String, CodingKey {
        case deviceID = "device_id"
        case encryptionPublicKey = "encryption_public_key"
    }
}

struct RecipientDevicesResponse: Codable {
    let recipientDevices: [RecipientDeviceDTO]
    enum CodingKeys: String, CodingKey { case recipientDevices = "recipient_devices" }
}

struct GroupMemberDTO: Codable, Equatable {
    let userID: String
    let username: String
    let role: String
    let joinedAt: String

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username, role
        case joinedAt = "joined_at"
    }
}

struct GroupMembersResponse: Codable {
    let members: [GroupMemberDTO]
}

struct GroupMemberResponse: Codable {
    let member: GroupMemberDTO
}

struct SessionBootstrapResponse: Codable {
    let sessionID: String?
    let peerDeviceID: String?
    let status: String?

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case peerDeviceID = "peer_device_id"
        case status
    }
}

struct SenderKeyDTO: Codable, Equatable {
    let id: String
    let chatID: String
    let ownerDeviceID: String
    let recipientDeviceID: String
    let keyID: String
    let senderKeyEpoch: Int
    let algorithm: String
    let status: String
    let wrappedSenderKey: String

    enum CodingKeys: String, CodingKey {
        case id
        case chatID = "chat_id"
        case ownerDeviceID = "owner_device_id"
        case recipientDeviceID = "recipient_device_id"
        case keyID = "key_id"
        case senderKeyEpoch = "sender_key_epoch"
        case algorithm, status
        case wrappedSenderKey = "wrapped_sender_key"
    }
}

struct SenderKeysResponse: Codable {
    let senderKeys: [SenderKeyDTO]
    enum CodingKeys: String, CodingKey { case senderKeys = "sender_keys" }
}

struct SafetyNumberDTO: Codable, Equatable {
    let peerDeviceID: String
    let peerUsername: String
    let fingerprint: String
    let verified: Bool

    enum CodingKeys: String, CodingKey {
        case peerDeviceID = "peer_device_id"
        case peerUsername = "peer_username"
        case fingerprint, verified
    }
}

struct SafetyNumbersResponse: Codable {
    let safetyNumbers: [SafetyNumberDTO]
    enum CodingKeys: String, CodingKey { case safetyNumbers = "safety_numbers" }
}

struct UploadDTO: Codable, Equatable {
    let id: String
    let status: String
    let filename: String?
    let contentType: String?
    let mediaKind: String?
    let declaredByteSize: Int?
    let uploadedByteSize: Int?
    let expectedPartCount: Int?
    let uploadedPartIndexes: [Int]?
    let uploadedPartCount: Int?
    let ciphertextSha256: String?
    let completedAt: String?
    let ciphertext: String?

    enum CodingKeys: String, CodingKey {
        case id, status, filename
        case contentType = "content_type"
        case mediaKind = "media_kind"
        case declaredByteSize = "declared_byte_size"
        case uploadedByteSize = "uploaded_byte_size"
        case expectedPartCount = "expected_part_count"
        case uploadedPartIndexes = "uploaded_part_indexes"
        case uploadedPartCount = "uploaded_part_count"
        case ciphertextSha256 = "ciphertext_sha256"
        case completedAt = "completed_at"
        case ciphertext
    }
}

struct UploadResponse: Codable {
    let upload: UploadDTO
}

struct LinkMetadataDTO: Codable, Equatable {
    let url: String?
    let title: String?
    let description: String?
    let imageURL: String?

    enum CodingKeys: String, CodingKey {
        case url
        case title
        case description
        case imageURL = "image_url"
    }
}

struct LinkMetadataResponse: Codable {
    let metadata: LinkMetadataDTO
}

struct FederationPeerDTO: Codable, Equatable {
    let id: String
    let domain: String
    let displayName: String?
    let status: String
    let trustState: String
    let lastError: String?
    let lastSeenAt: String?
    let trustedAt: String?
    let insertedAt: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case domain
        case displayName = "display_name"
        case status
        case trustState = "trust_state"
        case lastError = "last_error"
        case lastSeenAt = "last_seen_at"
        case trustedAt = "trusted_at"
        case insertedAt = "inserted_at"
        case updatedAt = "updated_at"
    }
}

struct FederationDeliveryDTO: Codable, Equatable {
    let id: String
    let peerID: String
    let direction: String
    let eventType: String
    let status: String
    let payload: [String: JSONValue]
    let remoteDeliveryID: String?
    let attemptCount: Int
    let availableAt: String?
    let lastAttemptedAt: String?
    let deliveredAt: String?
    let lastError: String?
    let insertedAt: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case peerID = "peer_id"
        case direction
        case eventType = "event_type"
        case status
        case payload
        case remoteDeliveryID = "remote_delivery_id"
        case attemptCount = "attempt_count"
        case availableAt = "available_at"
        case lastAttemptedAt = "last_attempted_at"
        case deliveredAt = "delivered_at"
        case lastError = "last_error"
        case insertedAt = "inserted_at"
        case updatedAt = "updated_at"
    }
}

struct AdminOverviewDTO: Codable, Equatable {
    let users: Int
    let chats: Int
    let mediaUploads: Int
    let federationPeers: Int
    let queuedFederationDeliveries: Int?
    let pendingFederationPeers: Int

    enum CodingKeys: String, CodingKey {
        case users
        case chats
        case mediaUploads = "media_uploads"
        case federationPeers = "federation_peers"
        case queuedFederationDeliveries = "queued_federation_deliveries"
        case pendingFederationPeers = "pending_federation_peers"
    }
}

struct AdminOverviewResponse: Codable {
    let overview: AdminOverviewDTO
}

struct FederationPeersResponse: Codable {
    let peers: [FederationPeerDTO]
}

struct FederationPeerResponse: Codable {
    let peer: FederationPeerDTO
}

struct FederationPeerInviteResponse: Codable {
    let peer: FederationPeerDTO
    let inviteToken: String

    enum CodingKeys: String, CodingKey {
        case peer
        case inviteToken = "invite_token"
    }
}

struct FederationDeliveriesResponse: Codable {
    let deliveries: [FederationDeliveryDTO]
}

struct FederationDeliveryResponse: Codable {
    let delivery: FederationDeliveryDTO
}

struct CallDTO: Codable, Equatable {
    let id: String
    let chatID: String
    let status: String
    let mode: String

    enum CodingKeys: String, CodingKey {
        case id
        case chatID = "chat_id"
        case status, mode
    }
}

struct CallResponse: Codable {
    let call: CallDTO
}

struct CallSignalDTO: Codable, Equatable {
    let id: String?
    let callID: String
    let signalType: String
    let fromDeviceID: String
    let targetDeviceID: String?
    let payload: String?
    let insertedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case callID = "call_id"
        case signalType = "signal_type"
        case fromDeviceID = "from_device_id"
        case targetDeviceID = "target_device_id"
        case payload
        case insertedAt = "inserted_at"
    }
}

struct CallSignalsResponse: Codable {
    let signals: [CallSignalDTO]
}

struct CallKeyDTO: Codable, Equatable {
    let keyEpoch: Int
    let algorithm: String
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case keyEpoch = "key_epoch"
        case algorithm
        case createdAt = "created_at"
    }
}

struct CallKeysResponse: Codable {
    let keys: [CallKeyDTO]
}

struct EndpointStateDTO: Codable, Equatable {
    let endpointID: String
    let exists: Bool
    let pendingMediaEventCount: Int

    enum CodingKeys: String, CodingKey {
        case endpointID = "endpoint_id"
        case exists
        case pendingMediaEventCount = "pending_media_event_count"
    }
}

struct WebRTCEndpointResponse: Codable {
    let endpoint: EndpointStateDTO
    let mediaEvents: [String]?

    enum CodingKeys: String, CodingKey {
        case endpoint
        case mediaEvents = "media_events"
    }
}

struct TurnCredentialsResponse: Codable {
    struct TurnDTO: Codable {
        let username: String
        let password: String
        let ttlSeconds: Int
        let expiresAt: String
        let uris: [String]

        enum CodingKeys: String, CodingKey {
            case username, password, uris
            case ttlSeconds = "ttl_seconds"
            case expiresAt = "expires_at"
        }
    }

    let turn: TurnDTO
}

struct BootstrapResponse: Codable {
    let service: String?
    let version: String?
    let timestamp: String?
}

struct HealthResponse: Codable {
    let status: String
}
