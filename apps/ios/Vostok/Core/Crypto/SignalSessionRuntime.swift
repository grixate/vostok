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
}

actor SignalSessionRuntime: SignalSessionRuntimeProtocol {
    private let apiClient: VostokAPIClientProtocol
    private let database: VostokDatabase
    private var didRunRuntimeSelfTest = false

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

        let normalizedPeerIDs = Array(Set(peerDeviceIDs.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) })).sorted()
        guard !normalizedPeerIDs.isEmpty else { return [] }

        var establishedIDs: [String] = []
        let now = ISO8601DateFormatter().string(from: Date())

        for peerDeviceID in normalizedPeerIDs {
            if let existing = database.sessionRecord(chatID: chatID, peerDeviceID: peerDeviceID),
               !existing.sessionID.isEmpty {
                establishedIDs.append(existing.sessionID)
                continue
            }

            do {
                let response = try await apiClient.sessionBootstrap(
                    token: token,
                    chatID: chatID,
                    request: .init(peerDeviceID: peerDeviceID)
                )

                let sessionID = response.sessionID ?? "session:\(chatID):\(peerDeviceID)"
                database.saveSessionRecord(
                    .init(
                        sessionID: sessionID,
                        chatID: chatID,
                        peerDeviceID: peerDeviceID,
                        status: response.status ?? "active",
                        updatedAt: now
                    )
                )
                establishedIDs.append(sessionID)
            } catch {
                // Keep message flow resilient: if bootstrap fails for one peer,
                // continue and let backend enforce strict requirements.
            }
        }

        return Array(Set(establishedIDs)).sorted()
    }

    func rekeySessionIfNeeded(
        token: String,
        chatID: String,
        peerDeviceID: String
    ) async -> String? {
        runRuntimeSelfTestIfNeeded()

        let normalizedPeerDeviceID = peerDeviceID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedPeerDeviceID.isEmpty else { return nil }

        do {
            let response = try await apiClient.sessionRekey(
                token: token,
                chatID: chatID,
                request: .init(peerDeviceID: normalizedPeerDeviceID)
            )
            let sessionID = response.sessionID ?? "session:\(chatID):\(normalizedPeerDeviceID)"
            database.saveSessionRecord(
                .init(
                    sessionID: sessionID,
                    chatID: chatID,
                    peerDeviceID: normalizedPeerDeviceID,
                    status: response.status ?? "active",
                    updatedAt: ISO8601DateFormatter().string(from: Date())
                )
            )
            return sessionID
        } catch {
            return nil
        }
    }

    private func runRuntimeSelfTestIfNeeded() {
        guard !didRunRuntimeSelfTest else { return }
        didRunRuntimeSelfTest = true

        #if canImport(libsignal)
        _ = curve_internal_fast_tests(1)
        #endif
    }
}
