import Foundation

@MainActor
final class ContactListViewModel: ObservableObject {
    @Published var members: [UserDTO] = []
    @Published var searchQuery = ""
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let apiClient: VostokAPIClientProtocol
    private let chatRepository: ChatRepository

    init(apiClient: VostokAPIClientProtocol, chatRepository: ChatRepository) {
        self.apiClient = apiClient
        self.chatRepository = chatRepository
    }

    func load(token: String, currentUsername: String?) async {
        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await apiClient.users(token: token)
            let ownUsername = currentUsername?.lowercased()
            members = response.users
                .filter { $0.username.lowercased() != ownUsername }
                .sorted { $0.username.localizedCaseInsensitiveCompare($1.username) == .orderedAscending }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func createDirectChat(token: String, username: String) async throws -> ChatDTO {
        try await chatRepository.createDirectChat(token: token, username: username)
    }

    var filteredMembers: [UserDTO] {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return members }
        return members.filter { $0.username.localizedCaseInsensitiveContains(query) }
    }
}
