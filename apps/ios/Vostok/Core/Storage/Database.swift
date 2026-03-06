import Foundation
import GRDB
import Security

final class VostokDatabase {
    struct SessionRecord: Codable, Equatable {
        let sessionID: String
        let chatID: String
        let peerDeviceID: String
        let status: String
        let signalAddressName: String
        let signalAddressDeviceID: Int
        let sessionPayload: String?
        let updatedAt: String
    }

    struct SenderKeyRecord: Codable, Equatable, Identifiable {
        let id: String
        let chatID: String
        let ownerDeviceID: String
        let recipientDeviceID: String
        let keyID: String
        let senderKeyEpoch: Int
        let algorithm: String
        let status: String
        let wrappedSenderKey: String
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
                    SELECT session_id, chat_id, peer_device_id, status, signal_address_name,
                           signal_address_device_id, session_payload, updated_at
                    FROM signal_session
                    WHERE chat_id = ? AND peer_device_id = ?
                    LIMIT 1
                    """,
                    arguments: [chatID, peerDeviceID]
                ) else {
                    return nil
                }
                return mapSessionRecord(row)
            }
        } catch {
            return nil
        }
    }

    func sessionRecords(chatID: String) -> [SessionRecord] {
        do {
            return try dbQueue.read { db in
                let rows = try Row.fetchAll(
                    db,
                    sql: """
                    SELECT session_id, chat_id, peer_device_id, status, signal_address_name,
                           signal_address_device_id, session_payload, updated_at
                    FROM signal_session
                    WHERE chat_id = ?
                    ORDER BY updated_at DESC, peer_device_id ASC
                    """,
                    arguments: [chatID]
                )
                return rows.compactMap(mapSessionRecord)
            }
        } catch {
            return []
        }
    }

    func saveSessionRecord(_ record: SessionRecord) {
        do {
            try dbQueue.write { db in
                try db.execute(
                    sql: """
                    INSERT INTO signal_session (
                        session_id,
                        chat_id,
                        peer_device_id,
                        status,
                        signal_address_name,
                        signal_address_device_id,
                        session_payload,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(chat_id, peer_device_id) DO UPDATE SET
                      session_id = excluded.session_id,
                      status = excluded.status,
                      signal_address_name = excluded.signal_address_name,
                      signal_address_device_id = excluded.signal_address_device_id,
                      session_payload = excluded.session_payload,
                      updated_at = excluded.updated_at
                    """,
                    arguments: [
                        record.sessionID,
                        record.chatID,
                        record.peerDeviceID,
                        record.status,
                        record.signalAddressName,
                        record.signalAddressDeviceID,
                        record.sessionPayload,
                        record.updatedAt
                    ]
                )
            }
        } catch {
            // Best-effort local cache only.
        }
    }

    func senderKeyRecords(chatID: String) -> [SenderKeyRecord] {
        do {
            return try dbQueue.read { db in
                let rows = try Row.fetchAll(
                    db,
                    sql: """
                    SELECT id, chat_id, owner_device_id, recipient_device_id, key_id,
                           sender_key_epoch, algorithm, status, wrapped_sender_key, updated_at
                    FROM sender_key
                    WHERE chat_id = ?
                    ORDER BY sender_key_epoch DESC, owner_device_id ASC, recipient_device_id ASC
                    """,
                    arguments: [chatID]
                )
                return rows.compactMap(mapSenderKeyRecord)
            }
        } catch {
            return []
        }
    }

    func senderKeyRecord(chatID: String, ownerDeviceID: String, recipientDeviceID: String) -> SenderKeyRecord? {
        do {
            return try dbQueue.read { db in
                guard let row = try Row.fetchOne(
                    db,
                    sql: """
                    SELECT id, chat_id, owner_device_id, recipient_device_id, key_id,
                           sender_key_epoch, algorithm, status, wrapped_sender_key, updated_at
                    FROM sender_key
                    WHERE chat_id = ? AND owner_device_id = ? AND recipient_device_id = ?
                    ORDER BY sender_key_epoch DESC
                    LIMIT 1
                    """,
                    arguments: [chatID, ownerDeviceID, recipientDeviceID]
                ) else {
                    return nil
                }
                return mapSenderKeyRecord(row)
            }
        } catch {
            return nil
        }
    }

    func saveSenderKeyRecords(_ records: [SenderKeyRecord]) {
        guard !records.isEmpty else { return }

        do {
            try dbQueue.write { db in
                for record in records {
                    try db.execute(
                        sql: """
                        INSERT INTO sender_key (
                            id,
                            chat_id,
                            owner_device_id,
                            recipient_device_id,
                            key_id,
                            sender_key_epoch,
                            algorithm,
                            status,
                            wrapped_sender_key,
                            updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                          chat_id = excluded.chat_id,
                          owner_device_id = excluded.owner_device_id,
                          recipient_device_id = excluded.recipient_device_id,
                          key_id = excluded.key_id,
                          sender_key_epoch = excluded.sender_key_epoch,
                          algorithm = excluded.algorithm,
                          status = excluded.status,
                          wrapped_sender_key = excluded.wrapped_sender_key,
                          updated_at = excluded.updated_at
                        """,
                        arguments: [
                            record.id,
                            record.chatID,
                            record.ownerDeviceID,
                            record.recipientDeviceID,
                            record.keyID,
                            record.senderKeyEpoch,
                            record.algorithm,
                            record.status,
                            record.wrappedSenderKey,
                            record.updatedAt
                        ]
                    )
                }
            }
        } catch {
            // Best-effort local cache only.
        }
    }

    private func mapSessionRecord(_ row: Row) -> SessionRecord? {
        guard let sessionID: String = row["session_id"],
              let chatID: String = row["chat_id"],
              let peerDeviceID: String = row["peer_device_id"],
              let status: String = row["status"],
              let signalAddressName: String = row["signal_address_name"],
              let signalAddressDeviceID: Int = row["signal_address_device_id"],
              let updatedAt: String = row["updated_at"]
        else {
            return nil
        }

        let sessionPayload: String? = row["session_payload"]

        return SessionRecord(
            sessionID: sessionID,
            chatID: chatID,
            peerDeviceID: peerDeviceID,
            status: status,
            signalAddressName: signalAddressName,
            signalAddressDeviceID: signalAddressDeviceID,
            sessionPayload: sessionPayload,
            updatedAt: updatedAt
        )
    }

    private func mapSenderKeyRecord(_ row: Row) -> SenderKeyRecord? {
        guard let id: String = row["id"],
              let chatID: String = row["chat_id"],
              let ownerDeviceID: String = row["owner_device_id"],
              let recipientDeviceID: String = row["recipient_device_id"],
              let keyID: String = row["key_id"],
              let senderKeyEpoch: Int = row["sender_key_epoch"],
              let algorithm: String = row["algorithm"],
              let status: String = row["status"],
              let wrappedSenderKey: String = row["wrapped_sender_key"],
              let updatedAt: String = row["updated_at"]
        else {
            return nil
        }

        return SenderKeyRecord(
            id: id,
            chatID: chatID,
            ownerDeviceID: ownerDeviceID,
            recipientDeviceID: recipientDeviceID,
            keyID: keyID,
            senderKeyEpoch: senderKeyEpoch,
            algorithm: algorithm,
            status: status,
            wrappedSenderKey: wrappedSenderKey,
            updatedAt: updatedAt
        )
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
                table.column("signal_address_name", .text).notNull().defaults(to: "")
                table.column("signal_address_device_id", .integer).notNull().defaults(to: 1)
                table.column("session_payload", .text)
                table.column("updated_at", .text).notNull()
                table.uniqueKey(["chat_id", "peer_device_id"])
            }
        }

        migrator.registerMigration("v2_signal_runtime") { db in
            let existingSessionColumns = try db.columns(in: "signal_session").map(\.name)

            if !existingSessionColumns.contains("signal_address_name") {
                try db.alter(table: "signal_session") { table in
                    table.add(column: "signal_address_name", .text).notNull().defaults(to: "")
                }
            }

            if !existingSessionColumns.contains("signal_address_device_id") {
                try db.alter(table: "signal_session") { table in
                    table.add(column: "signal_address_device_id", .integer).notNull().defaults(to: 1)
                }
            }

            if !existingSessionColumns.contains("session_payload") {
                try db.alter(table: "signal_session") { table in
                    table.add(column: "session_payload", .text)
                }
            }

            try db.create(table: "sender_key", ifNotExists: true) { table in
                table.column("id", .text).notNull().primaryKey()
                table.column("chat_id", .text).notNull()
                table.column("owner_device_id", .text).notNull()
                table.column("recipient_device_id", .text).notNull()
                table.column("key_id", .text).notNull()
                table.column("sender_key_epoch", .integer).notNull()
                table.column("algorithm", .text).notNull()
                table.column("status", .text).notNull()
                table.column("wrapped_sender_key", .text).notNull()
                table.column("updated_at", .text).notNull()
                table.uniqueKey(["chat_id", "owner_device_id", "recipient_device_id", "key_id"])
            }
            try db.create(index: "idx_sender_key_chat_owner", on: "sender_key", columns: ["chat_id", "owner_device_id"], ifNotExists: true)
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
