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

    func load(token: String, chatID: String) async {
        do {
            await repository.flushPendingOutgoing(token: token, chatID: chatID)
            messages = try await repository.fetchMessages(token: token, chatID: chatID)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func send(token: String, chatID: String, deviceID: String) async {
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let recipientEnvelopes = await RecipientEnvelopeBuilder.build(
            apiClient: apiClient,
            token: token,
            chatID: chatID,
            fallbackDeviceID: deviceID
        )

        let request = CreateMessageRequest(
            clientID: UUID().uuidString,
            ciphertext: Data(text.utf8).base64EncodedString(),
            header: Data("{\"algorithm\":\"test\"}".utf8).base64EncodedString(),
            messageKind: "text",
            recipientEnvelopes: recipientEnvelopes,
            establishedSessionIDs: await sessionRuntime.ensureSessions(
                token: token,
                chatID: chatID,
                peerDeviceIDs: Array(recipientEnvelopes.keys)
            ),
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
        deviceID: String,
        filename: String,
        contentType: String,
        mediaKind: String,
        plaintext: Data
    ) async {
        do {
            let recipientEnvelopes = await RecipientEnvelopeBuilder.build(
                apiClient: apiClient,
                token: token,
                chatID: chatID,
                fallbackDeviceID: deviceID
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
                header: Data("{\"algorithm\":\"media-v1\"}".utf8).base64EncodedString(),
                messageKind: "media",
                recipientEnvelopes: recipientEnvelopes,
                establishedSessionIDs: await sessionRuntime.ensureSessions(
                    token: token,
                    chatID: chatID,
                    peerDeviceIDs: Array(recipientEnvelopes.keys)
                ),
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

    func edit(token: String, chatID: String, message: MessageDTO, deviceID: String, updatedText: String) async {
        let text = updatedText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let envelopes = await RecipientEnvelopeBuilder.build(
            apiClient: apiClient,
            token: token,
            chatID: chatID,
            fallbackDeviceID: deviceID
        )

        let request = EditMessageRequest(
            clientID: message.clientID ?? UUID().uuidString,
            ciphertext: Data(text.utf8).base64EncodedString(),
            header: Data("{\"algorithm\":\"test\"}".utf8).base64EncodedString(),
            messageKind: message.messageKind,
            recipientEnvelopes: envelopes,
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
}
