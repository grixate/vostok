import Foundation

/// A configured server connection, matching the web's `ServerEntry` type
/// from `apps/web/src/lib/multi-server.ts`.
struct ServerEntry: Codable, Identifiable, Equatable {
    /// Unique identifier (format: `srv_<uuid>`)
    let id: String
    /// User-facing server name
    var label: String
    /// Normalized server URL (e.g. `https://chat.example.com`)
    var url: String
    /// Hex color for server badge in chat list (e.g. `#FF5500`)
    var color: String
    /// Auth credentials (nil until authenticated)
    var auth: ServerAuth?
    /// Crypto device state (nil until registered)
    var device: ServerDevice?
    /// Server capabilities metadata
    var serverInfo: ServerInfoDTO?
    /// ISO 8601 timestamp of last successful connection
    var lastConnectedAt: String?
    /// Display order (0-based)
    var sortOrder: Int
    /// Whether this server should auto-connect
    var enabled: Bool

    /// Creates a new server entry with a generated ID.
    static func create(
        url: String,
        label: String,
        color: String = "#FF5500"
    ) -> ServerEntry {
        ServerEntry(
            id: "srv_\(UUID().uuidString.lowercased().prefix(12))",
            label: label,
            url: normalizeServerURL(url),
            color: color,
            auth: nil,
            device: nil,
            serverInfo: nil,
            lastConnectedAt: nil,
            sortOrder: 0,
            enabled: true
        )
    }
}

struct ServerAuth: Codable, Equatable {
    let token: String
    let userID: String
    let username: String
    let deviceID: String
}

struct ServerDevice: Codable, Equatable {
    let deviceID: String
    let identityPublicKey: String
}

struct ServerInfoDTO: Codable, Equatable {
    let name: String
    let version: String
    let authMode: String?

    enum CodingKeys: String, CodingKey {
        case name, version
        case authMode = "auth_mode"
    }
}

// MARK: – QualifiedChatId

/// A chat ID qualified with its server ID, format: `serverId::chatId`.
/// Matches the web's `QualifiedChatId` type from `multi-server.ts`.
typealias QualifiedChatId = String

extension QualifiedChatId {
    static func qualify(serverId: String, chatId: String) -> QualifiedChatId {
        "\(serverId)::\(chatId)"
    }
}

enum QualifiedChatIdParser {
    static func isQualified(_ value: String?) -> Bool {
        guard let value else { return false }
        return value.contains("::")
    }

    static func parse(_ qualifiedChatId: String) -> (serverId: String, chatId: String) {
        guard let separatorRange = qualifiedChatId.range(of: "::") else {
            return (serverId: "", chatId: qualifiedChatId)
        }
        let serverId = String(qualifiedChatId[qualifiedChatId.startIndex..<separatorRange.lowerBound])
        let chatId = String(qualifiedChatId[separatorRange.upperBound...])
        return (serverId: serverId, chatId: chatId)
    }

    static func serverId(from chatId: String?) -> String? {
        guard let chatId, isQualified(chatId) else { return nil }
        return parse(chatId).serverId
    }

    static func rawChatId(from chatId: String?) -> String? {
        guard let chatId else { return nil }
        if !isQualified(chatId) { return chatId }
        return parse(chatId).chatId
    }
}

// MARK: – ServerConnectionStatus

enum ServerConnectionStatus: String, Equatable {
    case disconnected
    case connecting
    case connected
    case offline
    case authRequired = "auth_required"
    case error
}

// MARK: – MergedChatSummary

/// A chat summary enriched with server metadata for unified display.
struct MergedChatSummary: Identifiable, Equatable {
    let chat: ChatDTO
    let rawId: String
    let serverId: String
    let qualifiedId: QualifiedChatId
    let serverLabel: String
    let serverColor: String
    let serverUrl: String

    var id: QualifiedChatId { qualifiedId }

    static func from(server: ServerEntry, chat: ChatDTO) -> MergedChatSummary {
        MergedChatSummary(
            chat: chat,
            rawId: chat.id,
            serverId: server.id,
            qualifiedId: .qualify(serverId: server.id, chatId: chat.id),
            serverLabel: server.label,
            serverColor: server.color,
            serverUrl: server.url
        )
    }
}

/// Sorts merged chats by latest message timestamp (newest first).
func sortMergedChats(_ chats: [MergedChatSummary]) -> [MergedChatSummary] {
    chats.sorted { left, right in
        let leftTime = left.chat.latestMessageAt ?? ""
        let rightTime = right.chat.latestMessageAt ?? ""
        return rightTime < leftTime
    }
}

// MARK: – URL normalization

func normalizeServerURL(_ url: String) -> String {
    var trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return "" }

    // Add https:// if no scheme
    if !trimmed.contains("://") {
        trimmed = "https://\(trimmed)"
    }

    guard var components = URLComponents(string: trimmed) else {
        return trimmed.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
    }

    // Reject scheme-only URLs or those without a valid host
    guard let host = components.host, !host.isEmpty else {
        return ""
    }

    components.fragment = nil
    components.path = components.path.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)

    return components.string ?? trimmed
}

/// Derives a WebSocket URL from a server base URL.
func socketURL(from baseURL: String) -> URL? {
    guard var components = URLComponents(string: baseURL) else { return nil }
    components.scheme = components.scheme == "https" ? "wss" : "ws"
    components.path = "/socket/device/websocket"
    return components.url
}
