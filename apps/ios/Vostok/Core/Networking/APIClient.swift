import Foundation

final class APIClient: VostokAPIClientProtocol {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    func health() async throws -> HealthResponse { try await request(path: "/health", method: "GET") }
    func apiHealth() async throws -> HealthResponse { try await request(path: "/api/v1/health", method: "GET") }
    func bootstrap() async throws -> BootstrapResponse { try await request(path: "/api/v1/bootstrap", method: "GET") }
    func ingestFederationDelivery(request payload: FederationDeliveryRequest) async throws -> FederationDeliveryResponse {
        try await request(path: "/api/v1/federation/deliveries", method: "POST", body: payload)
    }

    func acceptFederationPeerInvite(request payload: FederationPeerInviteAcceptRequest) async throws -> FederationPeerResponse {
        try await request(path: "/api/v1/federation/peers/accept", method: "POST", body: payload)
    }

    func register(request payload: RegisterRequest) async throws -> RegistrationResponse {
        try await request(path: "/api/v1/register", method: "POST", body: payload)
    }

    func challenge(deviceID: String) async throws -> ChallengeResponse {
        try await request(path: "/api/v1/auth/challenge", method: "POST", body: ["device_id": deviceID])
    }

    func verify(request payload: VerifyRequest) async throws -> VerifyResponse {
        try await request(path: "/api/v1/auth/verify", method: "POST", body: payload)
    }

    func me(token: String) async throws -> MeResponse { try await authed(path: "/api/v1/me", method: "GET", token: token) }

    func linkDevice(token: String, request: LinkDeviceRequest) async throws -> DeviceLinkResponse {
        try await authed(path: "/api/v1/devices/link", method: "POST", token: token, body: request)
    }

    func devices(token: String) async throws -> DevicesResponse {
        try await authed(path: "/api/v1/devices", method: "GET", token: token)
    }

    func revokeDevice(token: String, deviceID: String) async throws -> DevicesResponse {
        try await authed(path: "/api/v1/devices/\(deviceID)/revoke", method: "POST", token: token, body: EmptyBody())
    }

    func publishPrekeys(token: String, request: PublishPrekeysRequest) async throws -> PrekeyPublishResponse {
        try await authed(path: "/api/v1/devices/prekeys", method: "POST", token: token, body: request)
    }

    func prekeys(token: String, username: String) async throws -> PrekeyLookupResponse {
        try await authed(path: "/api/v1/users/\(username)/devices/prekeys", method: "GET", token: token)
    }

    func chats(token: String) async throws -> ChatsResponse { try await authed(path: "/api/v1/chats", method: "GET", token: token) }

    func createDirectChat(token: String, username: String) async throws -> ChatResponse {
        try await authed(path: "/api/v1/chats/direct", method: "POST", token: token, body: ["username": username])
    }

    func createGroup(token: String, request: CreateGroupRequest) async throws -> ChatResponse {
        try await authed(path: "/api/v1/chats/group", method: "POST", token: token, body: request)
    }

    func updateGroup(token: String, chatID: String, title: String) async throws -> ChatResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/group", method: "PATCH", token: token, body: ["title": title])
    }

    func groupMembers(token: String, chatID: String) async throws -> GroupMembersResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/members", method: "GET", token: token)
    }

    func updateGroupMember(token: String, chatID: String, userID: String, request: UpdateGroupMemberRequest) async throws -> GroupMemberResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/members/\(userID)", method: "PATCH", token: token, body: request)
    }

    func removeGroupMember(token: String, chatID: String, userID: String) async throws -> GroupMemberResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/members/\(userID)/remove", method: "POST", token: token, body: EmptyBody())
    }

    func recipientDevices(token: String, chatID: String) async throws -> RecipientDevicesResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/recipient-devices", method: "GET", token: token)
    }

    func messages(token: String, chatID: String) async throws -> MessagesResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/messages", method: "GET", token: token)
    }

    func createMessage(token: String, chatID: String, request: CreateMessageRequest) async throws -> MessageResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/messages", method: "POST", token: token, body: request)
    }

    func editMessage(token: String, chatID: String, messageID: String, request: EditMessageRequest) async throws -> MessageResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/messages/\(messageID)", method: "PATCH", token: token, body: request)
    }

    func deleteMessage(token: String, chatID: String, messageID: String) async throws -> MessageResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/messages/\(messageID)/delete", method: "POST", token: token, body: EmptyBody())
    }

    func togglePin(token: String, chatID: String, messageID: String) async throws -> MessageResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/messages/\(messageID)/pin", method: "POST", token: token, body: EmptyBody())
    }

    func toggleReaction(token: String, chatID: String, messageID: String, reactionKey: String) async throws -> MessageResponse {
        try await authed(
            path: "/api/v1/chats/\(chatID)/messages/\(messageID)/reactions",
            method: "POST",
            token: token,
            body: ["reaction_key": reactionKey]
        )
    }

    func senderKeys(token: String, chatID: String) async throws -> SenderKeysResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/sender-keys", method: "GET", token: token)
    }

    func distributeSenderKeys(token: String, chatID: String, request: DistributeSenderKeysRequest) async throws -> SenderKeysResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/sender-keys", method: "POST", token: token, body: request)
    }

    func sessionBootstrap(token: String, chatID: String, request: SessionBootstrapRequest) async throws -> SessionBootstrapResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/session-bootstrap", method: "POST", token: token, body: request)
    }

    func sessionRekey(token: String, chatID: String, request: SessionRekeyRequest) async throws -> SessionBootstrapResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/session-rekey", method: "POST", token: token, body: request)
    }

    func safetyNumbers(token: String, chatID: String) async throws -> SafetyNumbersResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/safety-numbers", method: "GET", token: token)
    }

    func verifySafetyNumber(token: String, chatID: String, peerDeviceID: String) async throws -> SafetyNumberDTO {
        struct Wrap: Codable { let safetyNumber: SafetyNumberDTO; enum CodingKeys: String, CodingKey { case safetyNumber = "safety_number" } }
        let wrap: Wrap = try await authed(
            path: "/api/v1/chats/\(chatID)/safety-numbers/\(peerDeviceID)/verify",
            method: "POST",
            token: token,
            body: EmptyBody()
        )
        return wrap.safetyNumber
    }

    func createUpload(token: String, request: CreateUploadRequest) async throws -> UploadResponse {
        try await authed(path: "/api/v1/media/uploads", method: "POST", token: token, body: request)
    }

    func uploadPart(token: String, id: String, request: UploadPartRequest) async throws -> UploadResponse {
        try await authed(path: "/api/v1/media/uploads/\(id)/part", method: "PATCH", token: token, body: request)
    }

    func uploadStatus(token: String, id: String) async throws -> UploadResponse {
        try await authed(path: "/api/v1/media/uploads/\(id)", method: "GET", token: token)
    }

    func completeUpload(token: String, id: String, request: CompleteUploadRequest) async throws -> UploadResponse {
        try await authed(path: "/api/v1/media/uploads/\(id)/complete", method: "POST", token: token, body: request)
    }

    func media(token: String, id: String) async throws -> UploadResponse {
        try await authed(path: "/api/v1/media/\(id)", method: "GET", token: token)
    }

    func linkMetadata(token: String, request: LinkMetadataRequest) async throws -> LinkMetadataResponse {
        try await authed(path: "/api/v1/media/link-metadata", method: "POST", token: token, body: request)
    }

    func adminOverview(token: String) async throws -> AdminOverviewResponse {
        try await authed(path: "/api/v1/admin/overview", method: "GET", token: token)
    }

    func federationPeers(token: String) async throws -> FederationPeersResponse {
        try await authed(path: "/api/v1/admin/federation/peers", method: "GET", token: token)
    }

    func createFederationPeer(token: String, request: CreateFederationPeerRequest) async throws -> FederationPeerResponse {
        try await authed(path: "/api/v1/admin/federation/peers", method: "POST", token: token, body: request)
    }

    func federationDeliveries(token: String) async throws -> FederationDeliveriesResponse {
        try await authed(path: "/api/v1/admin/federation/deliveries", method: "GET", token: token)
    }

    func createFederationDelivery(
        token: String,
        peerID: String,
        request: CreateFederationDeliveryRequest
    ) async throws -> FederationDeliveryResponse {
        try await authed(path: "/api/v1/admin/federation/peers/\(peerID)/deliveries", method: "POST", token: token, body: request)
    }

    func attemptFederationDelivery(
        token: String,
        jobID: String,
        request: AttemptFederationDeliveryRequest
    ) async throws -> FederationDeliveryResponse {
        try await authed(path: "/api/v1/admin/federation/deliveries/\(jobID)/attempt", method: "POST", token: token, body: request)
    }

    func updateFederationPeerStatus(
        token: String,
        peerID: String,
        request: UpdateFederationPeerStatusRequest
    ) async throws -> FederationPeerResponse {
        try await authed(path: "/api/v1/admin/federation/peers/\(peerID)/status", method: "POST", token: token, body: request)
    }

    func federationPeerHeartbeat(token: String, peerID: String) async throws -> FederationPeerResponse {
        try await authed(path: "/api/v1/admin/federation/peers/\(peerID)/heartbeat", method: "POST", token: token, body: EmptyBody())
    }

    func createFederationPeerInvite(token: String, peerID: String) async throws -> FederationPeerInviteResponse {
        try await authed(path: "/api/v1/admin/federation/peers/\(peerID)/invite", method: "POST", token: token, body: EmptyBody())
    }

    func createCall(token: String, chatID: String, mode: String) async throws -> CallResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/calls", method: "POST", token: token, body: ["mode": mode])
    }

    func activeCall(token: String, chatID: String) async throws -> CallResponse {
        try await authed(path: "/api/v1/chats/\(chatID)/calls/active", method: "GET", token: token)
    }

    func callState(token: String, callID: String) async throws -> CallResponse {
        try await authed(path: "/api/v1/calls/\(callID)", method: "GET", token: token)
    }

    func joinCall(token: String, callID: String, request: JoinCallRequest) async throws -> CallResponse {
        try await authed(path: "/api/v1/calls/\(callID)/join", method: "POST", token: token, body: request)
    }

    func callKeys(token: String, callID: String) async throws -> CallKeysResponse {
        try await authed(path: "/api/v1/calls/\(callID)/keys", method: "GET", token: token)
    }

    func rotateCallKeys(token: String, callID: String, request: RotateCallKeysRequest) async throws -> CallKeysResponse {
        try await authed(path: "/api/v1/calls/\(callID)/keys", method: "POST", token: token, body: request)
    }

    func provisionEndpoint(token: String, callID: String, request: ProvisionWebRTCEndpointRequest) async throws -> WebRTCEndpointResponse {
        try await authed(path: "/api/v1/calls/\(callID)/webrtc-endpoint", method: "POST", token: token, body: request)
    }

    func callSignals(token: String, callID: String) async throws -> CallSignalsResponse {
        try await authed(path: "/api/v1/calls/\(callID)/signals", method: "GET", token: token)
    }

    func emitSignal(token: String, callID: String, request: EmitSignalRequest) async throws -> CallSignalDTO {
        struct Wrap: Codable { let signal: CallSignalDTO }
        let wrap: Wrap = try await authed(path: "/api/v1/calls/\(callID)/signals", method: "POST", token: token, body: request)
        return wrap.signal
    }

    func endpointState(token: String, callID: String) async throws -> WebRTCEndpointResponse {
        try await authed(path: "/api/v1/calls/\(callID)/webrtc-endpoint", method: "GET", token: token)
    }

    func pushEndpointMediaEvent(token: String, callID: String, request: PushWebRTCMediaEventRequest) async throws -> WebRTCEndpointResponse {
        try await authed(path: "/api/v1/calls/\(callID)/webrtc-endpoint/media-events", method: "POST", token: token, body: request)
    }

    func pollEndpoint(token: String, callID: String) async throws -> WebRTCEndpointResponse {
        try await authed(path: "/api/v1/calls/\(callID)/webrtc-endpoint/poll", method: "POST", token: token, body: EmptyBody())
    }

    func leaveCall(token: String, callID: String) async throws -> CallResponse {
        try await authed(path: "/api/v1/calls/\(callID)/leave", method: "POST", token: token, body: EmptyBody())
    }

    func endCall(token: String, callID: String) async throws -> CallResponse {
        try await authed(path: "/api/v1/calls/\(callID)/end", method: "POST", token: token, body: EmptyBody())
    }

    func turnCredentials(token: String) async throws -> TurnCredentialsResponse {
        try await authed(path: "/api/v1/calls/turn-credentials", method: "POST", token: token, body: EmptyBody())
    }

    private struct EmptyBody: Codable {}

    private func request<Response: Decodable>(path: String, method: String) async throws -> Response {
        try await request(path: path, method: method, body: Optional<EmptyBody>.none, token: nil)
    }

    private func request<Response: Decodable, Body: Encodable>(path: String, method: String, body: Body) async throws -> Response {
        try await request(path: path, method: method, body: Optional(body), token: nil)
    }

    private func authed<Response: Decodable>(path: String, method: String, token: String) async throws -> Response {
        try await request(path: path, method: method, body: Optional<EmptyBody>.none, token: token)
    }

    private func authed<Response: Decodable, Body: Encodable>(path: String, method: String, token: String, body: Body) async throws -> Response {
        try await request(path: path, method: method, body: Optional(body), token: token)
    }

    private func request<Response: Decodable, Body: Encodable>(path: String, method: String, body: Body?, token: String?) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw VostokAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.httpBody = try encoder.encode(body)
        }

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw VostokAPIError.invalidResponse
            }

            guard (200...299).contains(http.statusCode) else {
                let envelope = try? decoder.decode(ErrorEnvelope.self, from: data)
                let message = envelope?.message ?? "Request failed with status \(http.statusCode)"
                if http.statusCode == 401 { throw VostokAPIError.unauthorized(message) }
                if http.statusCode == 404 { throw VostokAPIError.notFound(message) }
                throw VostokAPIError.validation(message)
            }

            return try decoder.decode(Response.self, from: data)
        } catch let error as VostokAPIError {
            throw error
        } catch {
            throw VostokAPIError.transport(error)
        }
    }
}
