import Foundation

/// Holds all service instances scoped to a single server.
/// Each connected server gets its own context with independent API client,
/// WebSocket, database, and Signal session runtime.
final class ServerContext {
    let serverEntry: ServerEntry
    let apiClient: VostokAPIClientProtocol
    let realtimeClient: PhoenixRealtimeClientProtocol
    let database: VostokDatabase
    let chatRepository: ChatRepository
    let messageRepository: MessageRepository
    let callRepository: CallRepository
    let mediaRepository: MediaRepository
    let mediaTransferService: MediaTransferService
    let signalSessionRuntime: SignalSessionRuntimeProtocol

    var connectionStatus: ServerConnectionStatus = .disconnected

    init(entry: ServerEntry) throws {
        self.serverEntry = entry

        guard let baseURL = URL(string: entry.url) else {
            throw ServerContextError.invalidURL(entry.url)
        }

        guard let wsURL = socketURL(from: entry.url) else {
            throw ServerContextError.invalidURL(entry.url)
        }

        let api = APIClient(baseURL: baseURL)
        let realtime = PhoenixRealtimeClient(socketURL: wsURL)

        // Per-server database: vostok_<serverId>.sqlite
        let database: VostokDatabase
        let dbURL = try ServerDatabaseManager.databaseURL(for: entry.id)
        let passphrase = ServerDatabaseManager.loadOrCreatePassphrase(for: entry.id)
        database = try VostokDatabase(databaseURL: dbURL, passphrase: passphrase)

        let chatRepo = InMemoryChatRepository(apiClient: api, database: database)
        let msgRepo = InMemoryMessageRepository(apiClient: api, database: database)
        let callRepo = NetworkCallRepository(apiClient: api)
        let mediaRepo = NetworkMediaRepository(apiClient: api)
        let mediaTransfer = MediaTransferService(repository: mediaRepo)
        let sessionRuntime = SignalSessionRuntime(apiClient: api, database: database)

        self.apiClient = api
        self.realtimeClient = realtime
        self.database = database
        self.chatRepository = chatRepo
        self.messageRepository = msgRepo
        self.callRepository = callRepo
        self.mediaRepository = mediaRepo
        self.mediaTransferService = mediaTransfer
        self.signalSessionRuntime = sessionRuntime
    }
}

enum ServerContextError: LocalizedError {
    case invalidURL(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL(let url): return "Invalid server URL: \(url)"
        }
    }
}

// MARK: – ServerDatabaseManager

/// Manages per-server SQLCipher database files.
/// Each server gets its own encrypted database in the app support directory.
enum ServerDatabaseManager {
    private static let keychainService = "chat.vostok.ios.sqlcipher"

    static func databaseURL(for serverId: String) throws -> URL {
        let fm = FileManager.default
        let base = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = base.appendingPathComponent("Vostok/servers", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        let sanitizedId = serverId.replacingOccurrences(of: "[^a-zA-Z0-9_-]", with: "_", options: .regularExpression)
        return dir.appendingPathComponent("vostok_\(sanitizedId).sqlite")
    }

    static func loadOrCreatePassphrase(for serverId: String) -> String {
        let account = "database.passphrase.\(serverId)"

        // Try loading existing
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]

        var item: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
           let data = item as? Data,
           let value = String(data: data, encoding: .utf8),
           !value.isEmpty {
            return value
        }

        // Generate new passphrase
        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max) }
        let value = Data(bytes).base64EncodedString()

        // Delete any stale entry before inserting (handles partial prior failures)
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(deleteQuery as CFDictionary)

        let insert: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemAdd(insert as CFDictionary, nil)

        if status != errSecSuccess {
            // Critical: if we can't save the passphrase, the database will be unrecoverable
            // on next launch. Log this prominently.
            print("[ServerDatabaseManager] CRITICAL: Failed to save passphrase to Keychain (status: \(status)). Database for server \(serverId) may be unrecoverable.")
        }

        // Verify the save succeeded by reading it back
        var verifyItem: CFTypeRef?
        let verifyStatus = SecItemCopyMatching(query as CFDictionary, &verifyItem)
        if verifyStatus != errSecSuccess {
            print("[ServerDatabaseManager] CRITICAL: Passphrase verification failed (status: \(verifyStatus)). Keychain may be locked or full.")
        }

        return value
    }

    /// Removes the database files and Keychain passphrase for a server.
    static func removeDatabase(for serverId: String) {
        if let url = try? databaseURL(for: serverId) {
            let fm = FileManager.default
            for suffix in ["", "-wal", "-shm"] {
                try? fm.removeItem(atPath: url.path + suffix)
            }
        }

        let account = "database.passphrase.\(serverId)"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}
