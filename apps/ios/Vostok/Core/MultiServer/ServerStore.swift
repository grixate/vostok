import Foundation

/// Persists the server list to disk as JSON in the app support directory.
/// Handles migration from legacy single-server auth (KeychainSessionStore + Environment.plist).
final class ServerStore {
    private static let fileName = "vostok.servers.json"
    private let fileURL: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("Vostok", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent(Self.fileName)
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    // MARK: – CRUD

    func load() -> [ServerEntry] {
        guard let data = try? Data(contentsOf: fileURL),
              let servers = try? decoder.decode([ServerEntry].self, from: data)
        else {
            return []
        }
        return servers.sorted(by: { $0.sortOrder < $1.sortOrder })
    }

    func save(_ servers: [ServerEntry]) {
        guard let data = try? encoder.encode(servers) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    func add(_ server: ServerEntry) -> [ServerEntry] {
        var servers = load()
        var entry = server
        entry.sortOrder = servers.count
        servers.append(entry)
        save(servers)
        return servers
    }

    func update(_ server: ServerEntry) -> [ServerEntry] {
        var servers = load()
        if let index = servers.firstIndex(where: { $0.id == server.id }) {
            servers[index] = server
        }
        save(servers)
        return servers
    }

    func remove(id: String) -> [ServerEntry] {
        var servers = load()
        servers.removeAll(where: { $0.id == id })
        for i in servers.indices {
            servers[i].sortOrder = i
        }
        save(servers)
        return servers
    }

    // MARK: – Legacy migration

    /// Migrates from single-server (KeychainSessionStore + Environment.plist) to multi-server.
    /// Called once on first launch after the multi-server update.
    /// Returns the migrated server list (or empty if nothing to migrate).
    func migrateFromLegacySingleServer(environment: AppEnvironment) -> [ServerEntry] {
        let existing = load()
        guard existing.isEmpty else { return existing }

        // Check if there's a legacy session in the Keychain
        guard let legacySession = KeychainSessionStore.shared.fetch() else {
            return []
        }

        // Create the first ServerEntry from the legacy data
        var server = ServerEntry.create(
            url: environment.baseURL.absoluteString,
            label: environment.instanceLabel.isEmpty ? "My Server" : environment.instanceLabel,
            color: "#FF5500"
        )

        server.auth = ServerAuth(
            token: legacySession.token,
            userID: legacySession.userID,
            username: legacySession.username,
            deviceID: legacySession.deviceID
        )

        server.device = ServerDevice(
            deviceID: legacySession.deviceID,
            identityPublicKey: ""
        )

        server.lastConnectedAt = ISO8601DateFormatter().string(from: Date())

        let servers = [server]
        save(servers)

        return servers
    }
}
