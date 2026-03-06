import Foundation

@MainActor
final class ConversationViewModel: ObservableObject {
    @Published var messages: [MessageDTO] = []
    @Published var composerText = ""
    @Published var errorMessage: String?
    @Published var replyTarget: MessageDTO?

    private let repository: MessageRepository
    private let mediaTransferService: MediaTransferService
    private let apiClient: VostokAPIClientProtocol
    private let sessionRuntime: SignalSessionRuntimeProtocol

    init(
        repository: MessageRepository,
        mediaTransferService: MediaTransferService,
        apiClient: VostokAPIClientProtocol,
        sessionRuntime: SignalSessionRuntimeProtocol
    ) {
        self.repository = repository
        self.mediaTransferService = mediaTransferService
        self.apiClient = apiClient
        self.sessionRuntime = sessionRuntime
    }

    func load(token: String, chatID: String, chatType: String, deviceID: String) async {
        do {
            await repository.flushPendingOutgoing(token: token, chatID: chatID)
            await warmCryptoState(
                token: token,
                chatID: chatID,
                chatType: chatType,
                deviceID: deviceID
            )
            messages = try await repository.fetchMessages(token: token, chatID: chatID)
            try? await repository.markChatRead(
                token: token,
                chatID: chatID,
                lastReadMessageID: messages.last?.id
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func send(token: String, chatID: String, chatType: String, deviceID: String) async {
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let sendContext = await prepareSendContext(
            token: token,
            chatID: chatID,
            chatType: chatType,
            deviceID: deviceID
        )

        let request = CreateMessageRequest(
            clientID: UUID().uuidString,
            ciphertext: Data(text.utf8).base64EncodedString(),
            header: encodedHeader(
                algorithm: sendContext.isGroupMessage ? "sender-key.v1" : "test",
                senderKeys: sendContext.senderKeys
            ),
            messageKind: "text",
            recipientEnvelopes: sendContext.recipientEnvelopes,
            establishedSessionIDs: sendContext.establishedSessionIDs,
            replyToMessageID: replyTarget?.id
        )

        do {
            let message = try await repository.sendMessage(token: token, chatID: chatID, request: request)
            upsert(message)
            composerText = ""
            replyTarget = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func uploadAttachmentAndSend(
        token: String,
        chatID: String,
        chatType: String,
        deviceID: String,
        filename: String,
        contentType: String,
        mediaKind: String,
        plaintext: Data
    ) async {
        do {
            let sendContext = await prepareSendContext(
                token: token,
                chatID: chatID,
                chatType: chatType,
                deviceID: deviceID
            )

            let transfer = try await mediaTransferService.uploadEncrypted(
                token: token,
                filename: filename,
                contentType: contentType,
                mediaKind: mediaKind,
                plaintext: plaintext
            )

            let payload = AttachmentCipherPayload(
                uploadID: transfer.upload.id,
                filename: filename,
                mediaKind: mediaKind,
                contentType: contentType,
                keyMaterialBase64: transfer.keyMaterialBase64,
                ciphertextSha256: transfer.ciphertextSha256,
                byteSize: transfer.plaintextByteSize
            )

            let ciphertext = try JSONEncoder().encode(payload).base64EncodedString()
            let request = CreateMessageRequest(
                clientID: UUID().uuidString,
                ciphertext: ciphertext,
                header: encodedHeader(
                    algorithm: "media-v1",
                    senderKeys: sendContext.senderKeys
                ),
                messageKind: "media",
                recipientEnvelopes: sendContext.recipientEnvelopes,
                establishedSessionIDs: sendContext.establishedSessionIDs,
                replyToMessageID: replyTarget?.id
            )

            let message = try await repository.sendMessage(token: token, chatID: chatID, request: request)
            upsert(message)
            replyTarget = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func downloadAttachment(token: String, payload: AttachmentCipherPayload) async throws -> Data {
        try await mediaTransferService.fetchAndDecrypt(
            token: token,
            uploadID: payload.uploadID,
            keyMaterialBase64: payload.keyMaterialBase64
        )
    }

    func edit(token: String, chatID: String, chatType: String, message: MessageDTO, deviceID: String, updatedText: String) async {
        let text = updatedText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let sendContext = await prepareSendContext(
            token: token,
            chatID: chatID,
            chatType: chatType,
            deviceID: deviceID
        )

        let request = EditMessageRequest(
            clientID: message.clientID ?? UUID().uuidString,
            ciphertext: Data(text.utf8).base64EncodedString(),
            header: encodedHeader(
                algorithm: sendContext.isGroupMessage ? "sender-key.v1" : "test",
                senderKeys: sendContext.senderKeys
            ),
            messageKind: message.messageKind,
            recipientEnvelopes: sendContext.recipientEnvelopes,
            replyToMessageID: message.replyToMessageID
        )

        do {
            let updated = try await repository.editMessage(token: token, chatID: chatID, messageID: message.id, request: request)
            upsert(updated)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func delete(token: String, chatID: String, messageID: String) async {
        do {
            let deleted = try await repository.deleteMessage(token: token, chatID: chatID, messageID: messageID)
            upsert(deleted)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func togglePin(token: String, chatID: String, messageID: String) async {
        do {
            let updated = try await repository.togglePin(token: token, chatID: chatID, messageID: messageID)
            upsert(updated)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggleReaction(token: String, chatID: String, messageID: String, reactionKey: String) async {
        do {
            let updated = try await repository.toggleReaction(token: token, chatID: chatID, messageID: messageID, reactionKey: reactionKey)
            upsert(updated)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func beginReply(to message: MessageDTO) {
        replyTarget = message
    }

    func cancelReply() {
        replyTarget = nil
    }

    private func upsert(_ message: MessageDTO) {
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            messages[index] = message
        } else {
            messages.append(message)
        }

        messages.sort {
            if $0.insertedAt == $1.insertedAt {
                return $0.id < $1.id
            }
            return $0.insertedAt < $1.insertedAt
        }
    }

    private func warmCryptoState(token: String, chatID: String, chatType: String, deviceID: String) async {
        let recipientEnvelopes = await RecipientEnvelopeBuilder.build(
            apiClient: apiClient,
            token: token,
            chatID: chatID,
            fallbackDeviceID: deviceID
        )
        let peerDeviceIDs = Array(recipientEnvelopes.keys)
        _ = await sessionRuntime.ensureSessions(token: token, chatID: chatID, peerDeviceIDs: peerDeviceIDs)

        guard chatType == "group" else { return }
        _ = await sessionRuntime.ensureGroupSenderKeys(
            token: token,
            chatID: chatID,
            ownerDeviceID: deviceID,
            recipientDeviceIDs: peerDeviceIDs
        )
    }

    private func prepareSendContext(
        token: String,
        chatID: String,
        chatType: String,
        deviceID: String
    ) async -> MessageSendContext {
        let recipientEnvelopes = await RecipientEnvelopeBuilder.build(
            apiClient: apiClient,
            token: token,
            chatID: chatID,
            fallbackDeviceID: deviceID
        )
        let peerDeviceIDs = Array(recipientEnvelopes.keys)
        let establishedSessionIDs = await sessionRuntime.ensureSessions(
            token: token,
            chatID: chatID,
            peerDeviceIDs: peerDeviceIDs
        )
        let senderKeys: [SenderKeyDTO]
        if chatType == "group" {
            senderKeys = await sessionRuntime.ensureGroupSenderKeys(
                token: token,
                chatID: chatID,
                ownerDeviceID: deviceID,
                recipientDeviceIDs: peerDeviceIDs
            )
        } else {
            senderKeys = []
        }

        return MessageSendContext(
            recipientEnvelopes: recipientEnvelopes,
            establishedSessionIDs: establishedSessionIDs,
            senderKeys: senderKeys,
            isGroupMessage: chatType == "group"
        )
    }

    private func encodedHeader(algorithm: String, senderKeys: [SenderKeyDTO]) -> String {
        var payload: [String: Any] = ["algorithm": algorithm]
        if let primarySenderKey = senderKeys.first {
            payload["sender_key_id"] = primarySenderKey.keyID
            payload["sender_key_epoch"] = primarySenderKey.senderKeyEpoch
            payload["sender_key_algorithm"] = primarySenderKey.algorithm
            payload["sender_key_recipients"] = senderKeys.map(\.recipientDeviceID).sorted()
        }

        let data = (try? JSONSerialization.data(withJSONObject: payload, options: []))
            ?? Data("{\"algorithm\":\"\(algorithm)\"}".utf8)
        return data.base64EncodedString()
    }
}

private struct MessageSendContext {
    let recipientEnvelopes: [String: String]
    let establishedSessionIDs: [String]
    let senderKeys: [SenderKeyDTO]
    let isGroupMessage: Bool
}
