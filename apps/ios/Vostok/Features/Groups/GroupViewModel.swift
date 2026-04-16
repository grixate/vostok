import Foundation

@MainActor
final class GroupViewModel: ObservableObject {
    @Published var createdGroup: ChatDTO?
    @Published var members: [GroupMemberDTO] = []
    @Published var inviteLinks: [InviteLinkDTO] = []
    @Published var lastError: String?
    @Published var isLoading = false

    private let repository: ChatRepository
    private let apiClient: VostokAPIClientProtocol

    init(repository: ChatRepository, apiClient: VostokAPIClientProtocol) {
        self.repository = repository
        self.apiClient = apiClient
    }

    // MARK: – Create

    func create(token: String, title: String, members: [String]) async {
        isLoading = true
        defer { isLoading = false }
        do {
            createdGroup = try await repository.createGroup(token: token, title: title, members: members)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func createChannel(token: String, title: String, description: String?, allowComments: Bool) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let request = CreateChannelRequest(title: title, description: description, allowComments: allowComments)
            let response = try await apiClient.createChannel(token: token, request: request)
            createdGroup = response.chat
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: – Members

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

    // MARK: – Leave / Delete

    func leave(token: String, chatID: String) async {
        do {
            _ = try await apiClient.leaveGroup(token: token, chatID: chatID)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func deleteChat(token: String, chatID: String) async {
        do {
            _ = try await apiClient.deleteGroup(token: token, chatID: chatID)
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: – Permissions

    func updatePermissions(token: String, chatID: String, permissions: [String: String]) async {
        do {
            _ = try await apiClient.updatePermissions(token: token, chatID: chatID, request: UpdatePermissionsRequest(permissions: permissions))
        } catch {
            lastError = error.localizedDescription
        }
    }

    func transferOwnership(token: String, chatID: String, newOwnerUserID: String) async {
        do {
            _ = try await apiClient.transferOwnership(token: token, chatID: chatID, request: TransferOwnershipRequest(newOwnerUserID: newOwnerUserID))
            await loadMembers(token: token, chatID: chatID)
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: – Invite Links

    func loadInviteLinks(token: String, chatID: String) async {
        do {
            inviteLinks = try await apiClient.inviteLinks(token: token, chatID: chatID).inviteLinks
        } catch {
            lastError = error.localizedDescription
        }
    }

    func createInviteLink(token: String, chatID: String) async {
        do {
            let response = try await apiClient.createInviteLink(token: token, chatID: chatID)
            inviteLinks.append(response.inviteLink)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func revokeInviteLink(token: String, chatID: String, linkID: String) async {
        do {
            _ = try await apiClient.revokeInviteLink(token: token, chatID: chatID, linkID: linkID)
            inviteLinks.removeAll(where: { $0.id == linkID })
        } catch {
            lastError = error.localizedDescription
        }
    }
}
