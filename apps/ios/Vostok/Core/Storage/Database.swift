import Foundation
import GRDB
import Security

final class VostokDatabase {
    struct SessionRecord: Codable, Equatable {
        let sessionID: String
        let chatID: String
        let peerDeviceID: String
        let status: String
        let updatedAt: String
    }

    private static let path = "vostok.sqlite"
    private static let keychainService = "chat.vostok.ios.sqlcipher"
    private static let keychainAccount = "database.passphrase"

    private let dbQueue: DatabaseQueue
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(databaseURL: URL? = nil, passphrase: String? = nil) throws {
        let resolvedDatabaseURL = try databaseURL ?? Self.databaseURL()
        let resolvedPassphrase = passphrase ?? Self.loadOrCreatePassphrase()
        let migrator = Self.makeMigrator()

        do {
            dbQueue = try Self.openEncryptedQueue(
                databaseURL: resolvedDatabaseURL,
                passphrase: resolvedPassphrase,
                migrator: migrator
            )
        } catch let dbError as DatabaseError where dbError.resultCode == .SQLITE_NOTADB {
            // Previous local builds may have created a plaintext file at this path.
            // Reset files and bootstrap a fresh SQLCipher database.
            try Self.removeDatabaseFiles(at: resolvedDatabaseURL)
            dbQueue = try Self.openEncryptedQueue(
                databaseURL: resolvedDatabaseURL,
                passphrase: resolvedPassphrase,
                migrator: migrator
            )
        }
    }

    func loadChats() -> [ChatDTO] {
        do {
            return try dbQueue.read { db in
                let rows = try Row.fetchAll(db, sql: "SELECT payload FROM chat_cache ORDER BY updated_at DESC")
                return rows.compactMap { row in
                    guard let data: Data = row["payload"] else { return nil }
                    return try? decoder.decode(ChatDTO.self, from: data)
                }
            }
        } catch {
            return []
        }
    }

    func saveChats(_ chats: [ChatDTO]) {
        do {
            try dbQueue.write { db in
                try db.execute(sql: "DELETE FROM chat_cache")
                let now = ISO8601DateFormatter().string(from: Date())
                for chat in chats {
                    let payload = try encoder.encode(chat)
                    try db.execute(
                        sql: """
                        INSERT INTO chat_cache (chat_id, payload, updated_at)
                        VALUES (?, ?, ?)
                        """,
                        arguments: [chat.id, payload, now]
                    )
                }
            }
        } catch {
            // Best-effort local cache only.
        }
    }

    func loadMessages(chatID: String) -> [MessageDTO] {
        do {
            return try dbQueue.read { db in
                let rows = try Row.fetchAll(
                    db,
                    sql: """
                    SELECT payload
                    FROM message_cache
                    WHERE chat_id = ?
                    ORDER BY inserted_at ASC, message_id ASC
                    """,
                    arguments: [chatID]
                )
                return rows.compactMap { row in
                    guard let data: Data = row["payload"] else { return nil }
                    return try? decoder.decode(MessageDTO.self, from: data)
                }
            }
        } catch {
            return []
        }
    }

    func saveMessages(chatID: String, messages: [MessageDTO]) {
        do {
            try dbQueue.write { db in
                try db.execute(sql: "DELETE FROM message_cache WHERE chat_id = ?", arguments: [chatID])
                for message in messages {
                    let payload = try encoder.encode(message)
                    try db.execute(
                        sql: """
                        INSERT INTO message_cache (chat_id, message_id, client_id, inserted_at, payload)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        arguments: [chatID, message.id, message.clientID, message.insertedAt, payload]
                    )
                }
            }
        } catch {
            // Best-effort local cache only.
        }
    }

    func loadPendingCreates() -> [String: [CreateMessageRequest]] {
        do {
            return try dbQueue.read { db in
                let rows = try Row.fetchAll(
                    db,
                    sql: """
                    SELECT chat_id, payload
                    FROM pending_outbox
                    ORDER BY created_at ASC
                    """
                )

                var grouped: [String: [CreateMessageRequest]] = [:]
                for row in rows {
                    guard let chatID: String = row["chat_id"],
                          let payload: Data = row["payload"],
                          let request = try? decoder.decode(CreateMessageRequest.self, from: payload)
                    else {
                        continue
                    }
                    grouped[chatID, default: []].append(request)
                }
                return grouped
            }
        } catch {
            return [:]
        }
    }

    func savePendingCreates(_ pendingByChatID: [String: [CreateMessageRequest]]) {
        do {
            try dbQueue.write { db in
                try db.execute(sql: "DELETE FROM pending_outbox")
                let now = ISO8601DateFormatter().string(from: Date())
                for (chatID, requests) in pendingByChatID {
                    for request in requests {
                        let payload = try encoder.encode(request)
                        try db.execute(
                            sql: """
                            INSERT INTO pending_outbox (chat_id, client_id, payload, created_at)
                            VALUES (?, ?, ?, ?)
                            """,
                            arguments: [chatID, request.clientID, payload, now]
                        )
                    }
                }
            }
        } catch {
            // Best-effort local cache only.
        }
    }

    func sessionRecord(chatID: String, peerDeviceID: String) -> SessionRecord? {
        do {
            return try dbQueue.read { db in
                guard let row = try Row.fetchOne(
                    db,
                    sql: """
                    SELECT session_id, chat_id, peer_device_id, status, updated_at
                    FROM signal_session
                    WHERE chat_id = ? AND peer_device_id = ?
                    LIMIT 1
                    """,
                    arguments: [chatID, peerDeviceID]
                ) else {
                    return nil
                }

                guard let sessionID: String = row["session_id"],
                      let loadedChatID: String = row["chat_id"],
                      let loadedPeerDeviceID: String = row["peer_device_id"],
                      let status: String = row["status"],
                      let updatedAt: String = row["updated_at"]
                else {
                    return nil
                }

                return SessionRecord(
                    sessionID: sessionID,
                    chatID: loadedChatID,
                    peerDeviceID: loadedPeerDeviceID,
                    status: status,
                    updatedAt: updatedAt
                )
            }
        } catch {
            return nil
        }
    }

    func saveSessionRecord(_ record: SessionRecord) {
        do {
            try dbQueue.write { db in
                try db.execute(
                    sql: """
                    INSERT INTO signal_session (session_id, chat_id, peer_device_id, status, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(chat_id, peer_device_id) DO UPDATE SET
                      session_id = excluded.session_id,
                      status = excluded.status,
                      updated_at = excluded.updated_at
                    """,
                    arguments: [
                        record.sessionID,
                        record.chatID,
                        record.peerDeviceID,
                        record.status,
                        record.updatedAt
                    ]
                )
            }
        } catch {
            // Best-effort local cache only.
        }
    }

    private static func makeMigrator() -> DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1_cache_and_sessions") { db in
            try db.create(table: "chat_cache", ifNotExists: true) { table in
                table.column("chat_id", .text).notNull().primaryKey()
                table.column("payload", .blob).notNull()
                table.column("updated_at", .text).notNull()
            }

            try db.create(table: "message_cache", ifNotExists: true) { table in
                table.column("chat_id", .text).notNull()
                table.column("message_id", .text).notNull()
                table.column("client_id", .text)
                table.column("inserted_at", .text).notNull()
                table.column("payload", .blob).notNull()
                table.primaryKey(["chat_id", "message_id"])
            }
            try db.create(index: "idx_message_cache_chat_inserted", on: "message_cache", columns: ["chat_id", "inserted_at"], ifNotExists: true)

            try db.create(table: "pending_outbox", ifNotExists: true) { table in
                table.column("chat_id", .text).notNull()
                table.column("client_id", .text).notNull().primaryKey()
                table.column("payload", .blob).notNull()
                table.column("created_at", .text).notNull()
            }
            try db.create(index: "idx_pending_outbox_chat_created", on: "pending_outbox", columns: ["chat_id", "created_at"], ifNotExists: true)

            try db.create(table: "signal_session", ifNotExists: true) { table in
                table.column("session_id", .text).notNull()
                table.column("chat_id", .text).notNull()
                table.column("peer_device_id", .text).notNull()
                table.column("status", .text).notNull()
                table.column("updated_at", .text).notNull()
                table.uniqueKey(["chat_id", "peer_device_id"])
            }
        }
        return migrator
    }

    private static func openEncryptedQueue(
        databaseURL: URL,
        passphrase: String,
        migrator: DatabaseMigrator
    ) throws -> DatabaseQueue {
        var configuration = Configuration()
        configuration.foreignKeysEnabled = true
        configuration.prepareDatabase { db in
            let escaped = passphrase.replacingOccurrences(of: "'", with: "''")
            try db.execute(sql: "PRAGMA key = '\(escaped)'")
            try db.execute(sql: "PRAGMA journal_mode = WAL")
            try db.execute(sql: "PRAGMA secure_delete = ON")
        }

        let queue = try DatabaseQueue(path: databaseURL.path, configuration: configuration)
        try migrator.migrate(queue)
        return queue
    }

    private static func removeDatabaseFiles(at databaseURL: URL) throws {
        let fm = FileManager.default
        let candidates = [
            databaseURL.path,
            "\(databaseURL.path)-wal",
            "\(databaseURL.path)-shm"
        ]

        for candidate in candidates where fm.fileExists(atPath: candidate) {
            try fm.removeItem(atPath: candidate)
        }
    }

    private static func databaseURL() throws -> URL {
        let fm = FileManager.default
        let base = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = base.appendingPathComponent("Vostok", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent(path)
    }

    private static func loadOrCreatePassphrase() -> String {
        if let data = loadKeychain(account: keychainAccount),
           let value = String(data: data, encoding: .utf8),
           !value.isEmpty {
            return value
        }

        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max) }
        let value = Data(bytes).base64EncodedString()
        saveKeychain(account: keychainAccount, data: Data(value.utf8))
        return value
    }

    private static func loadKeychain(account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else { return nil }
        return item as? Data
    }

    private static func saveKeychain(account: String, data: Data) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account
        ]

        SecItemDelete(query as CFDictionary)

        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(insert as CFDictionary, nil)
    }
}
