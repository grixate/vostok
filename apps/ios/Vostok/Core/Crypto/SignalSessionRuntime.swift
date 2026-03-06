import CryptoKit
import Foundation
#if canImport(libsignal)
import libsignal
#endif

protocol SignalSessionRuntimeProtocol {
    func ensureSessions(
        token: String,
        chatID: String,
        peerDeviceIDs: [String]
    ) async -> [String]
    func ensureGroupSenderKeys(
        token: String,
        chatID: String,
        ownerDeviceID: String,
        recipientDeviceIDs: [String]
    ) async -> [SenderKeyDTO]
    func cachedSenderKeys(chatID: String) async -> [SenderKeyDTO]
}

actor SignalSessionRuntime: SignalSessionRuntimeProtocol {
    private struct SessionPayloadSnapshot: Codable {
        let sessionID: String
        let chatID: String
        let peerDeviceID: String
        let status: String
        let signalAddressName: String
        let signalAddressDeviceID: Int
        let updatedAt: String
    }

    private let apiClient: VostokAPIClientProtocol
    private let database: VostokDatabase
    private var didRunRuntimeSelfTest = false
    private let encoder = JSONEncoder()

    init(apiClient: VostokAPIClientProtocol, database: VostokDatabase) {
        self.apiClient = apiClient
        self.database = database
    }

    func ensureSessions(
        token: String,
        chatID: String,
        peerDeviceIDs: [String]
    ) async -> [String] {
        runRuntimeSelfTestIfNeeded()

        let normalizedPeerIDs = normalizedDeviceIDs(peerDeviceIDs)
        guard !normalizedPeerIDs.isEmpty else { return [] }

        var establishedIDs: [String] = []
        for peerDeviceID in normalizedPeerIDs {
            if let existing = database.sessionRecord(chatID: chatID, peerDeviceID: peerDeviceID),
               !existing.sessionID.isEmpty {
                establishedIDs.append(existing.sessionID)
                continue
            }

            if let sessionID = await establishOrRefreshSession(
                token: token,
                chatID: chatID,
                peerDeviceID: peerDeviceID,
                useRekey: false
            ) {
                establishedIDs.append(sessionID)
            }
        }

        return Array(Set(establishedIDs)).sorted()
    }

    func ensureGroupSenderKeys(
        token: String,
        chatID: String,
        ownerDeviceID: String,
        recipientDeviceIDs: [String]
    ) async -> [SenderKeyDTO] {
        runRuntimeSelfTestIfNeeded()

        let normalizedOwner = ownerDeviceID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedOwner.isEmpty else { return await cachedSenderKeys(chatID: chatID) }

        let normalizedRecipients = normalizedDeviceIDs(recipientDeviceIDs).filter { $0 != normalizedOwner }
        guard !normalizedRecipients.isEmpty else { return await cachedSenderKeys(chatID: chatID) }

        let remoteKeys = await syncRemoteSenderKeys(token: token, chatID: chatID)
        let groupedRemoteOwnerKeys = remoteKeys.filter {
            $0.ownerDeviceID == normalizedOwner && $0.status != "superseded"
        }
        let coveredRecipients = Set(groupedRemoteOwnerKeys.map(\.recipientDeviceID))
        if Set(normalizedRecipients).isSubset(of: coveredRecipients) {
            return groupedRemoteOwnerKeys.sorted { lhs, rhs in
                if lhs.senderKeyEpoch == rhs.senderKeyEpoch {
                    return lhs.recipientDeviceID < rhs.recipientDeviceID
                }
                return lhs.senderKeyEpoch > rhs.senderKeyEpoch
            }
        }

        let cachedKeys = database.senderKeyRecords(chatID: chatID)
            .filter { $0.ownerDeviceID == normalizedOwner && $0.status != "superseded" }
        let coveredCachedRecipients = Set(cachedKeys.map(\.recipientDeviceID))
        if Set(normalizedRecipients).isSubset(of: coveredCachedRecipients) {
            return cachedKeys.map(dto(from:)).sorted { lhs, rhs in
                if lhs.senderKeyEpoch == rhs.senderKeyEpoch {
                    return lhs.recipientDeviceID < rhs.recipientDeviceID
                }
                return lhs.senderKeyEpoch > rhs.senderKeyEpoch
            }
        }

        let nextEpoch = max(cachedKeys.map(\.senderKeyEpoch).max() ?? 0, groupedRemoteOwnerKeys.map(\.senderKeyEpoch).max() ?? 0) + 1
        let keyID = UUID().uuidString
        let request = DistributeSenderKeysRequest(
            keyID: keyID,
            senderKeyEpoch: nextEpoch,
            algorithm: "sender-key.v1",
            recipientWrappedKeys: Dictionary(uniqueKeysWithValues: normalizedRecipients.map {
                ($0, Self.wrapSenderKey(chatID: chatID, ownerDeviceID: normalizedOwner, recipientDeviceID: $0, keyID: keyID, epoch: nextEpoch))
            })
        )

        do {
            let response = try await apiClient.distributeSenderKeys(token: token, chatID: chatID, request: request)
            persistSenderKeys(response.senderKeys)
            return response.senderKeys.filter { $0.ownerDeviceID == normalizedOwner }
        } catch {
            return await cachedSenderKeys(chatID: chatID)
        }
    }

    func cachedSenderKeys(chatID: String) async -> [SenderKeyDTO] {
        database.senderKeyRecords(chatID: chatID).map(dto(from:))
    }

    func rekeySessionIfNeeded(
        token: String,
        chatID: String,
        peerDeviceID: String
    ) async -> String? {
        runRuntimeSelfTestIfNeeded()
        return await establishOrRefreshSession(
            token: token,
            chatID: chatID,
            peerDeviceID: peerDeviceID,
            useRekey: true
        )
    }

    private func establishOrRefreshSession(
        token: String,
        chatID: String,
        peerDeviceID: String,
        useRekey: Bool
    ) async -> String? {
        let normalizedPeerDeviceID = peerDeviceID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedPeerDeviceID.isEmpty else { return nil }

        do {
            let response = try await sessionResponse(
                token: token,
                chatID: chatID,
                peerDeviceID: normalizedPeerDeviceID,
                useRekey: useRekey
            )
            let sessionID = response.sessionID ?? "session:\(chatID):\(normalizedPeerDeviceID)"
            let updatedAt = ISO8601DateFormatter().string(from: Date())
            let addressDeviceID = stableSignalAddressDeviceID(for: normalizedPeerDeviceID)
            let status = response.status ?? "active"

            let payloadSnapshot = SessionPayloadSnapshot(
                sessionID: sessionID,
                chatID: chatID,
                peerDeviceID: normalizedPeerDeviceID,
                status: status,
                signalAddressName: normalizedPeerDeviceID,
                signalAddressDeviceID: addressDeviceID,
                updatedAt: updatedAt
            )
            let sessionPayload = (try? encoder.encode(payloadSnapshot)).map { $0.base64EncodedString() }

            database.saveSessionRecord(
                .init(
                    sessionID: sessionID,
                    chatID: chatID,
                    peerDeviceID: normalizedPeerDeviceID,
                    status: status,
                    signalAddressName: normalizedPeerDeviceID,
                    signalAddressDeviceID: addressDeviceID,
                    sessionPayload: sessionPayload,
                    updatedAt: updatedAt
                )
            )
            return sessionID
        } catch {
            return database.sessionRecord(chatID: chatID, peerDeviceID: normalizedPeerDeviceID)?.sessionID
        }
    }

    private func sessionResponse(
        token: String,
        chatID: String,
        peerDeviceID: String,
        useRekey: Bool
    ) async throws -> SessionBootstrapResponse {
        if useRekey {
            return try await apiClient.sessionRekey(
                token: token,
                chatID: chatID,
                request: .init(peerDeviceID: peerDeviceID)
            )
        }

        return try await apiClient.sessionBootstrap(
            token: token,
            chatID: chatID,
            request: .init(peerDeviceID: peerDeviceID)
        )
    }

    private func syncRemoteSenderKeys(token: String, chatID: String) async -> [SenderKeyDTO] {
        do {
            let response = try await apiClient.senderKeys(token: token, chatID: chatID)
            persistSenderKeys(response.senderKeys)
            return response.senderKeys
        } catch {
            return database.senderKeyRecords(chatID: chatID).map(dto(from:))
        }
    }

    private func persistSenderKeys(_ senderKeys: [SenderKeyDTO]) {
        guard !senderKeys.isEmpty else { return }

        let updatedAt = ISO8601DateFormatter().string(from: Date())
        database.saveSenderKeyRecords(
            senderKeys.map {
                .init(
                    id: $0.id,
                    chatID: $0.chatID,
                    ownerDeviceID: $0.ownerDeviceID,
                    recipientDeviceID: $0.recipientDeviceID,
                    keyID: $0.keyID,
                    senderKeyEpoch: $0.senderKeyEpoch,
                    algorithm: $0.algorithm,
                    status: $0.status,
                    wrappedSenderKey: $0.wrappedSenderKey,
                    updatedAt: updatedAt
                )
            }
        )
    }

    private func dto(from record: VostokDatabase.SenderKeyRecord) -> SenderKeyDTO {
        SenderKeyDTO(
            id: record.id,
            chatID: record.chatID,
            ownerDeviceID: record.ownerDeviceID,
            recipientDeviceID: record.recipientDeviceID,
            keyID: record.keyID,
            senderKeyEpoch: record.senderKeyEpoch,
            algorithm: record.algorithm,
            status: record.status,
            wrappedSenderKey: record.wrappedSenderKey
        )
    }

    private func normalizedDeviceIDs(_ deviceIDs: [String]) -> [String] {
        Array(
            Set(
                deviceIDs
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
            )
        ).sorted()
    }

    private func stableSignalAddressDeviceID(for peerDeviceID: String) -> Int {
        let digest = SHA256.hash(data: Data(peerDeviceID.utf8))
        let prefix = digest.prefix(4)
        let raw = prefix.reduce(0) { partial, byte in
            (partial << 8) | Int(byte)
        }
        let normalized = raw & Int(Int32.max)
        return max(1, normalized)
    }

    private static func wrapSenderKey(
        chatID: String,
        ownerDeviceID: String,
        recipientDeviceID: String,
        keyID: String,
        epoch: Int
    ) -> String {
        let seed = "\(chatID):\(ownerDeviceID):\(recipientDeviceID):\(keyID):\(epoch)"
        let digest = SHA256.hash(data: Data(seed.utf8))
        return Data(digest).base64EncodedString()
    }

    private func runRuntimeSelfTestIfNeeded() {
        guard !didRunRuntimeSelfTest else { return }
        didRunRuntimeSelfTest = true

        #if canImport(libsignal)
        _ = curve_internal_fast_tests(1)
        #endif
    }
}
