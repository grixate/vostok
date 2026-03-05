import Foundation

struct ChatListLocalState: Codable, Equatable {
    var unreadCounts: [String: Int]
    var mutedChatIDs: Set<String>
    var pinnedChatIDs: [String]
    var archivedChatIDs: Set<String>

    static let empty = ChatListLocalState(
        unreadCounts: [:],
        mutedChatIDs: [],
        pinnedChatIDs: [],
        archivedChatIDs: []
    )
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
}
