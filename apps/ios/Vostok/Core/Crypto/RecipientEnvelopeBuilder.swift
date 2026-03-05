import Foundation

enum RecipientEnvelopeBuilder {
    static func build(
        apiClient: VostokAPIClientProtocol,
        token: String,
        chatID: String,
        fallbackDeviceID: String
    ) async -> [String: String] {
        let envelopePayload = Data("local-envelope".utf8).base64EncodedString()

        let recipientDeviceIDs = ((try? await apiClient
            .recipientDevices(token: token, chatID: chatID)
            .recipientDevices
            .map(\.deviceID)) ?? [])

        var targetDeviceIDs = recipientDeviceIDs
        if targetDeviceIDs.isEmpty {
            targetDeviceIDs = [fallbackDeviceID]
        }

        let sanitizedIDs = targetDeviceIDs
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        if sanitizedIDs.isEmpty {
            return [fallbackDeviceID: envelopePayload]
        }

        let uniqueIDs = Array(Set(sanitizedIDs)).sorted()
        return Dictionary(uniqueKeysWithValues: uniqueIDs.map { ($0, envelopePayload) })
    }
}
