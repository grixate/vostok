import Foundation

struct ChatListLocalState: Codable, Equatable {
    var unreadCounts: [String: Int]
    var mutedChatIDs: Set<String>
    var pinnedChatIDs: [String]
    var archivedChatIDs: Set<String>
    var lastMessagePreviews: [String: String]

    static let empty = ChatListLocalState(
        unreadCounts: [:],
        mutedChatIDs: [],
        pinnedChatIDs: [],
        archivedChatIDs: [],
        lastMessagePreviews: [:]
    )

    // Custom decoder for backward compatibility with stored data that lacks lastMessagePreviews
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        unreadCounts = try container.decode([String: Int].self, forKey: .unreadCounts)
        mutedChatIDs = try container.decode(Set<String>.self, forKey: .mutedChatIDs)
        pinnedChatIDs = try container.decode([String].self, forKey: .pinnedChatIDs)
        archivedChatIDs = try container.decode(Set<String>.self, forKey: .archivedChatIDs)
        lastMessagePreviews = (try? container.decode([String: String].self, forKey: .lastMessagePreviews)) ?? [:]
    }

    init(
        unreadCounts: [String: Int],
        mutedChatIDs: Set<String>,
        pinnedChatIDs: [String],
        archivedChatIDs: Set<String>,
        lastMessagePreviews: [String: String]
    ) {
        self.unreadCounts = unreadCounts
        self.mutedChatIDs = mutedChatIDs
        self.pinnedChatIDs = pinnedChatIDs
        self.archivedChatIDs = archivedChatIDs
        self.lastMessagePreviews = lastMessagePreviews
    }
}

final class ChatListLocalStateStore {
    private let userDefaults: UserDefaults
    private let storageKey: String
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(
        userDefaults: UserDefaults = .standard,
        storageKey: String = "vostok.chat_list.local_state"
    ) {
        self.userDefaults = userDefaults
        self.storageKey = storageKey
    }

    func load() -> ChatListLocalState {
        guard let data = userDefaults.data(forKey: storageKey),
              let decoded = try? decoder.decode(ChatListLocalState.self, from: data)
        else {
            return .empty
        }
        return decoded
    }

    func save(_ state: ChatListLocalState) {
        guard let encoded = try? encoder.encode(state) else { return }
        userDefaults.set(encoded, forKey: storageKey)
    }

    func setLastMessagePreview(_ text: String, chatID: String) {
        var state = load()
        state.lastMessagePreviews[chatID] = text
        save(state)
    }
}
