import Foundation

@MainActor
final class GroupViewModel: ObservableObject {
    @Published var createdGroup: ChatDTO?
    @Published var members: [GroupMemberDTO] = []
    @Published var lastError: String?
    @Published var isLoading = false

    private let repository: ChatRepository
    private let apiClient: VostokAPIClientProtocol

    init(repository: ChatRepository, apiClient: VostokAPIClientProtocol) {
        self.repository = repository
        self.apiClient = apiClient
    }

    func create(token: String, title: String, members: [String]) async {
        isLoading = true
        defer { isLoading = false }
        do {
            createdGroup = try await repository.createGroup(token: token, title: title, members: members)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func loadMembers(token: String, chatID: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            members = try await apiClient.groupMembers(token: token, chatID: chatID).members
        } catch {
            lastError = error.localizedDescription
        }
    }

    func setRole(token: String, chatID: String, userID: String, role: String) async {
        do {
            _ = try await apiClient.updateGroupMember(
                token: token,
                chatID: chatID,
                userID: userID,
                request: .init(role: role)
            )
            await loadMembers(token: token, chatID: chatID)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func remove(token: String, chatID: String, userID: String) async {
        do {
            _ = try await apiClient.removeGroupMember(token: token, chatID: chatID, userID: userID)
            await loadMembers(token: token, chatID: chatID)
        } catch {
            lastError = error.localizedDescription
        }
    }
}
