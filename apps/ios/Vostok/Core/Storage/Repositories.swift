import Foundation

protocol ChatRepository {
    func fetchChats(token: String) async throws -> [ChatDTO]
    func createDirectChat(token: String, username: String) async throws -> ChatDTO
    func createGroup(token: String, title: String, members: [String]) async throws -> ChatDTO
}

protocol MessageRepository {
    func fetchMessages(token: String, chatID: String) async throws -> [MessageDTO]
    func markChatRead(token: String, chatID: String, lastReadMessageID: String?) async throws
    func sendMessage(token: String, chatID: String, request: CreateMessageRequest) async throws -> MessageDTO
    func editMessage(token: String, chatID: String, messageID: String, request: EditMessageRequest) async throws -> MessageDTO
    func deleteMessage(token: String, chatID: String, messageID: String) async throws -> MessageDTO
    func togglePin(token: String, chatID: String, messageID: String) async throws -> MessageDTO
    func toggleReaction(token: String, chatID: String, messageID: String, reactionKey: String) async throws -> MessageDTO
    func flushPendingOutgoing(token: String, chatID: String?) async
    func applyRealtimeMessageHint(chatID: String, messageID: String) async
}

protocol CallRepository {
    func createCall(token: String, chatID: String, mode: String) async throws -> CallDTO
    func activeCall(token: String, chatID: String) async throws -> CallDTO
    func callState(token: String, callID: String) async throws -> CallDTO
    func provisionEndpoint(token: String, callID: String) async throws -> WebRTCEndpointResponse
    func endpointState(token: String, callID: String) async throws -> WebRTCEndpointResponse
    func joinCall(token: String, callID: String, trackKind: String) async throws -> CallDTO
    func callSignals(token: String, callID: String) async throws -> [CallSignalDTO]
    func emitSignal(token: String, callID: String, signalType: String, payload: String, targetDeviceID: String?) async throws -> CallSignalDTO
    func pushEndpointMediaEvent(token: String, callID: String, event: String) async throws -> WebRTCEndpointResponse
    func turnCredentials(token: String) async throws -> TurnCredentialsResponse.TurnDTO
    func leaveCall(token: String, callID: String) async throws -> CallDTO
    func endCall(token: String, callID: String) async throws -> CallDTO
    func pollEndpoint(token: String, callID: String) async throws -> WebRTCEndpointResponse
}

protocol MediaRepository {
    func createUpload(token: String, request: CreateUploadRequest) async throws -> UploadDTO
    func uploadPart(token: String, id: String, request: UploadPartRequest) async throws -> UploadDTO
    func uploadStatus(token: String, id: String) async throws -> UploadDTO
    func completeUpload(token: String, id: String, request: CompleteUploadRequest) async throws -> UploadDTO
    func media(token: String, id: String) async throws -> UploadDTO
}

actor InMemoryChatRepository: ChatRepository {
    private let apiClient: VostokAPIClientProtocol
    private var cache: [ChatDTO] = []
    private let database: VostokDatabase

    init(
        apiClient: VostokAPIClientProtocol,
        database: VostokDatabase
    ) {
        self.apiClient = apiClient
        self.database = database
        self.cache = database.loadChats()
    }

    func fetchChats(token: String) async throws -> [ChatDTO] {
        do {
            let response = try await apiClient.chats(token: token)
            cache = response.chats
            database.saveChats(cache)
            return response.chats
        } catch {
            if !cache.isEmpty { return cache }
            throw error
        }
    }

    func createDirectChat(token: String, username: String) async throws -> ChatDTO {
        let chat = try await apiClient.createDirectChat(token: token, username: username).chat
        cache.removeAll { $0.id == chat.id }
        cache.insert(chat, at: 0)
        database.saveChats(cache)
        return chat
    }

    func createGroup(token: String, title: String, members: [String]) async throws -> ChatDTO {
        let chat = try await apiClient.createGroup(token: token, request: .init(title: title, members: members)).chat
        cache.removeAll { $0.id == chat.id }
        cache.insert(chat, at: 0)
        database.saveChats(cache)
        return chat
    }
}

actor InMemoryMessageRepository: MessageRepository {
    private let apiClient: VostokAPIClientProtocol
    private let database: VostokDatabase
    private var cache: [String: [MessageDTO]] = [:]
    private var pendingCreatesByChatID: [String: [CreateMessageRequest]] = [:]

    init(
        apiClient: VostokAPIClientProtocol,
        database: VostokDatabase
    ) {
        self.apiClient = apiClient
        self.database = database
        self.pendingCreatesByChatID = database.loadPendingCreates()
    }

    func fetchMessages(token: String, chatID: String) async throws -> [MessageDTO] {
        if cache[chatID] == nil {
            cache[chatID] = database.loadMessages(chatID: chatID)
        }

        do {
            let response = try await apiClient.messages(token: token, chatID: chatID)
            let merged = mergeDeduped(existing: cache[chatID] ?? [], incoming: response.messages)
            cache[chatID] = merged
            persistCache()
            return merged
        } catch {
            let cached = cache[chatID] ?? []
            if !cached.isEmpty { return cached }
            throw error
        }
    }

    func sendMessage(token: String, chatID: String, request: CreateMessageRequest) async throws -> MessageDTO {
        do {
            let response = try await apiClient.createMessage(token: token, chatID: chatID, request: request)
            removePendingCreate(chatID: chatID, clientID: request.clientID)
            let merged = mergeDeduped(existing: cache[chatID] ?? [], incoming: [response.message])
            cache[chatID] = merged
            persistCache()
            return response.message
        } catch let error as VostokAPIError {
            guard case .transport = error else { throw error }
            queuePendingCreate(chatID: chatID, request: request)
            let pendingMessage = makePendingMessage(chatID: chatID, request: request)
            let merged = mergeDeduped(existing: cache[chatID] ?? [], incoming: [pendingMessage])
            cache[chatID] = merged
            persistCache()
            return pendingMessage
        } catch {
            throw error
        }
    }

    func markChatRead(token: String, chatID: String, lastReadMessageID: String?) async throws {
        _ = try await apiClient.markChatRead(token: token, chatID: chatID, lastReadMessageID: lastReadMessageID)
    }

    func editMessage(token: String, chatID: String, messageID: String, request: EditMessageRequest) async throws -> MessageDTO {
        let response = try await apiClient.editMessage(token: token, chatID: chatID, messageID: messageID, request: request)
        let merged = mergeDeduped(existing: cache[chatID] ?? [], incoming: [response.message])
        cache[chatID] = merged
        persistCache()
        return response.message
    }

    func deleteMessage(token: String, chatID: String, messageID: String) async throws -> MessageDTO {
        let response = try await apiClient.deleteMessage(token: token, chatID: chatID, messageID: messageID)
        let merged = mergeDeduped(existing: cache[chatID] ?? [], incoming: [response.message])
        cache[chatID] = merged
        persistCache()
        return response.message
    }

    func togglePin(token: String, chatID: String, messageID: String) async throws -> MessageDTO {
        let response = try await apiClient.togglePin(token: token, chatID: chatID, messageID: messageID)
        let merged = mergeDeduped(existing: cache[chatID] ?? [], incoming: [response.message])
        cache[chatID] = merged
        persistCache()
        return response.message
    }

    func toggleReaction(token: String, chatID: String, messageID: String, reactionKey: String) async throws -> MessageDTO {
        let response = try await apiClient.toggleReaction(token: token, chatID: chatID, messageID: messageID, reactionKey: reactionKey)
        let merged = mergeDeduped(existing: cache[chatID] ?? [], incoming: [response.message])
        cache[chatID] = merged
        persistCache()
        return response.message
    }

    func flushPendingOutgoing(token: String, chatID: String?) async {
        let targetChatIDs: [String]
        if let chatID {
            targetChatIDs = [chatID]
        } else {
            targetChatIDs = Array(pendingCreatesByChatID.keys)
        }

        for targetChatID in targetChatIDs {
            guard var queue = pendingCreatesByChatID[targetChatID], !queue.isEmpty else { continue }

            var remaining: [CreateMessageRequest] = []

            while !queue.isEmpty {
                let request = queue.removeFirst()
                do {
                    let response = try await apiClient.createMessage(token: token, chatID: targetChatID, request: request)
                    let merged = mergeDeduped(existing: cache[targetChatID] ?? [], incoming: [response.message])
                    cache[targetChatID] = merged
                    persistCache()
                } catch let error as VostokAPIError {
                    if case .transport = error {
                        remaining.append(request)
                        remaining.append(contentsOf: queue)
                        queue.removeAll()
                    } else {
                        // Drop non-retriable requests and continue with the next one.
                    }
                } catch {
                    remaining.append(request)
                    remaining.append(contentsOf: queue)
                    queue.removeAll()
                }
            }

            if remaining.isEmpty {
                pendingCreatesByChatID[targetChatID] = nil
            } else {
                pendingCreatesByChatID[targetChatID] = dedupePendingCreates(remaining)
            }
            persistPendingQueue()
        }
    }

    func applyRealtimeMessageHint(chatID: String, messageID: String) async {
        if cache[chatID] == nil {
            cache[chatID] = database.loadMessages(chatID: chatID)
        }

        guard var messages = cache[chatID] else { return }
        if messages.contains(where: { $0.id == messageID }) { return }

        let placeholder = MessageDTO(
            id: messageID,
            chatID: chatID,
            clientID: nil,
            messageKind: "text",
            senderDeviceID: "",
            insertedAt: ISO8601DateFormatter().string(from: Date()),
            pinnedAt: nil,
            header: nil,
            ciphertext: nil,
            replyToMessageID: nil,
            editedAt: nil,
            deletedAt: nil,
            recipientDeviceIDs: [],
            reactions: [],
            recipientEnvelope: nil
        )

        messages.append(placeholder)
        cache[chatID] = messages
        persistCache()
    }

    private func mergeDeduped(existing: [MessageDTO], incoming: [MessageDTO]) -> [MessageDTO] {
        var byID: [String: MessageDTO] = [:]
        var idByClientID: [String: String] = [:]

        existing.forEach { byID[$0.id] = $0 }
        existing.forEach { message in
            if let clientID = message.clientID {
                idByClientID[clientID] = message.id
            }
        }

        incoming.forEach { message in
            if let clientID = message.clientID,
               let existingID = idByClientID[clientID],
               existingID != message.id {
                byID.removeValue(forKey: existingID)
            }

            byID[message.id] = message
            if let clientID = message.clientID {
                idByClientID[clientID] = message.id
            }
        }

        return byID.values.sorted {
            if $0.insertedAt == $1.insertedAt {
                return $0.id < $1.id
            }
            return $0.insertedAt < $1.insertedAt
        }
    }

    private func makePendingMessage(chatID: String, request: CreateMessageRequest) -> MessageDTO {
        MessageDTO(
            id: "pending:\(request.clientID)",
            chatID: chatID,
            clientID: request.clientID,
            messageKind: request.messageKind,
            senderDeviceID: "local-device",
            insertedAt: ISO8601DateFormatter().string(from: Date()),
            pinnedAt: nil,
            header: request.header,
            ciphertext: request.ciphertext,
            replyToMessageID: request.replyToMessageID,
            editedAt: nil,
            deletedAt: nil,
            recipientDeviceIDs: Array(request.recipientEnvelopes.keys),
            reactions: [],
            recipientEnvelope: nil
        )
    }

    private func queuePendingCreate(chatID: String, request: CreateMessageRequest) {
        let existing = pendingCreatesByChatID[chatID] ?? []
        pendingCreatesByChatID[chatID] = dedupePendingCreates(existing + [request])
        persistPendingQueue()
    }

    private func removePendingCreate(chatID: String, clientID: String) {
        guard var queue = pendingCreatesByChatID[chatID] else { return }
        queue.removeAll { $0.clientID == clientID }
        if queue.isEmpty {
            pendingCreatesByChatID[chatID] = nil
        } else {
            pendingCreatesByChatID[chatID] = queue
        }
        persistPendingQueue()
    }

    private func dedupePendingCreates(_ requests: [CreateMessageRequest]) -> [CreateMessageRequest] {
        var seen = Set<String>()
        var ordered: [CreateMessageRequest] = []

        for request in requests {
            if seen.contains(request.clientID) { continue }
            seen.insert(request.clientID)
            ordered.append(request)
        }

        return ordered
    }

    private func persistCache() {
        for (chatID, messages) in cache {
            database.saveMessages(chatID: chatID, messages: messages)
        }
    }

    private func persistPendingQueue() {
        database.savePendingCreates(pendingCreatesByChatID)
    }
}

actor NetworkCallRepository: CallRepository {
    private let apiClient: VostokAPIClientProtocol

    init(apiClient: VostokAPIClientProtocol) {
        self.apiClient = apiClient
    }

    func createCall(token: String, chatID: String, mode: String) async throws -> CallDTO {
        try await apiClient.createCall(token: token, chatID: chatID, mode: mode).call
    }

    func activeCall(token: String, chatID: String) async throws -> CallDTO {
        try await apiClient.activeCall(token: token, chatID: chatID).call
    }

    func callState(token: String, callID: String) async throws -> CallDTO {
        try await apiClient.callState(token: token, callID: callID).call
    }

    func provisionEndpoint(token: String, callID: String) async throws -> WebRTCEndpointResponse {
        try await apiClient.provisionEndpoint(token: token, callID: callID, request: .init(endpointID: nil))
    }

    func endpointState(token: String, callID: String) async throws -> WebRTCEndpointResponse {
        try await apiClient.endpointState(token: token, callID: callID)
    }

    func joinCall(token: String, callID: String, trackKind: String) async throws -> CallDTO {
        try await apiClient.joinCall(
            token: token,
            callID: callID,
            request: .init(trackKind: trackKind, e2eeCapable: nil, e2eeAlgorithm: nil, e2eeKeyEpoch: nil)
        ).call
    }

    func callSignals(token: String, callID: String) async throws -> [CallSignalDTO] {
        try await apiClient.callSignals(token: token, callID: callID).signals
    }

    func emitSignal(
        token: String,
        callID: String,
        signalType: String,
        payload: String,
        targetDeviceID: String?
    ) async throws -> CallSignalDTO {
        try await apiClient.emitSignal(
            token: token,
            callID: callID,
            request: .init(signalType: signalType, payload: payload, targetDeviceID: targetDeviceID)
        )
    }

    func pushEndpointMediaEvent(token: String, callID: String, event: String) async throws -> WebRTCEndpointResponse {
        try await apiClient.pushEndpointMediaEvent(token: token, callID: callID, request: .init(event: event))
    }

    func turnCredentials(token: String) async throws -> TurnCredentialsResponse.TurnDTO {
        try await apiClient.turnCredentials(token: token).turn
    }

    func leaveCall(token: String, callID: String) async throws -> CallDTO {
        try await apiClient.leaveCall(token: token, callID: callID).call
    }

    func endCall(token: String, callID: String) async throws -> CallDTO {
        try await apiClient.endCall(token: token, callID: callID).call
    }

    func pollEndpoint(token: String, callID: String) async throws -> WebRTCEndpointResponse {
        try await apiClient.pollEndpoint(token: token, callID: callID)
    }
}

actor NetworkMediaRepository: MediaRepository {
    private let apiClient: VostokAPIClientProtocol

    init(apiClient: VostokAPIClientProtocol) {
        self.apiClient = apiClient
    }

    func createUpload(token: String, request: CreateUploadRequest) async throws -> UploadDTO {
        try await apiClient.createUpload(token: token, request: request).upload
    }

    func uploadPart(token: String, id: String, request: UploadPartRequest) async throws -> UploadDTO {
        try await apiClient.uploadPart(token: token, id: id, request: request).upload
    }

    func uploadStatus(token: String, id: String) async throws -> UploadDTO {
        try await apiClient.uploadStatus(token: token, id: id).upload
    }

    func completeUpload(token: String, id: String, request: CompleteUploadRequest) async throws -> UploadDTO {
        try await apiClient.completeUpload(token: token, id: id, request: request).upload
    }

    func media(token: String, id: String) async throws -> UploadDTO {
        try await apiClient.media(token: token, id: id).upload
    }
}
