import Foundation

@MainActor
final class ContactListViewModel: ObservableObject {
    @Published var contacts: [String] = []
    @Published var searchQuery = ""
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let chatRepository: ChatRepository

    init(chatRepository: ChatRepository) {
        self.chatRepository = chatRepository
    }

    func load(token: String, currentUsername: String?) async {
        isLoading = true
        defer { isLoading = false }

        do {
            let chats = try await chatRepository.fetchChats(token: token)
            contacts = Self.deriveContacts(from: chats, currentUsername: currentUsername)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func createDirectChat(token: String, username: String) async throws -> ChatDTO {
        try await chatRepository.createDirectChat(token: token, username: username)
    }

    var filteredContacts: [String] {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return contacts }
        return contacts.filter { $0.localizedCaseInsensitiveContains(query) }
    }

    static func deriveContacts(from chats: [ChatDTO], currentUsername: String?) -> [String] {
        let ownUsername = currentUsername?.lowercased()
        var seen = Set<String>()
        var ordered: [String] = []

        for chat in chats {
            for username in chat.participantUsernames {
                let trimmed = username.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { continue }
                if trimmed.lowercased() == ownUsername { continue }
                if seen.contains(trimmed.lowercased()) { continue }
                seen.insert(trimmed.lowercased())
                ordered.append(trimmed)
            }
        }

        return ordered.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }
}
