import SwiftUI

struct CreateGroupView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    private let container: AppContainer

    @State private var title = ""
    @State private var searchQuery = ""
    @State private var selectedUsernames: Set<String> = []
    @StateObject private var membersViewModel: ContactListViewModel
    @StateObject private var groupViewModel: GroupViewModel

    init(container: AppContainer) {
        self.container = container
        _membersViewModel = StateObject(
            wrappedValue: ContactListViewModel(
                apiClient: container.apiClient,
                chatRepository: container.chatRepository
            )
        )
        _groupViewModel = StateObject(
            wrappedValue: GroupViewModel(repository: container.chatRepository, apiClient: container.apiClient)
        )
    }

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canCreate: Bool {
        !trimmedTitle.isEmpty && !selectedUsernames.isEmpty && !groupViewModel.isLoading
    }

    private var filteredMembers: [UserDTO] {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return membersViewModel.members }
        return membersViewModel.members.filter { $0.username.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        List {
            Section {
                TextField("Group name", text: $title)
                    .textInputAutocapitalization(.sentences)
            }

            Section {
                if !selectedUsernames.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(Array(selectedUsernames).sorted(), id: \.self) { username in
                                VStack(spacing: 4) {
                                    ZStack(alignment: .topTrailing) {
                                        VostokAvatar(title: username, size: 48)
                                        Button {
                                            selectedUsernames.remove(username)
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .font(.system(size: 18))
                                                .foregroundStyle(VostokColors.labelSecondary)
                                                .background(Circle().fill(VostokColors.primaryBackground))
                                        }
                                        .offset(x: 4, y: -4)
                                    }
                                    Text(username)
                                        .font(VostokTypography.caption)
                                        .lineLimit(1)
                                }
                            }
                        }
                        .padding(.vertical, 8)
                    }
                }
            } header: {
                Text(selectedUsernames.isEmpty
                     ? "Add Members"
                     : "Members (\(selectedUsernames.count) selected)")
            }

            Section {
                if membersViewModel.isLoading {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                } else {
                    ForEach(filteredMembers, id: \.id) { member in
                        Button {
                            if selectedUsernames.contains(member.username) {
                                selectedUsernames.remove(member.username)
                            } else {
                                selectedUsernames.insert(member.username)
                            }
                        } label: {
                            HStack(spacing: 10) {
                                VostokAvatar(title: member.username)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(member.username)
                                        .font(VostokTypography.bodyEmphasized)
                                        .foregroundStyle(VostokColors.labelPrimary)
                                    Text("@\(member.username)")
                                        .font(VostokTypography.footnote)
                                        .foregroundStyle(VostokColors.labelSecondary)
                                }
                                Spacer()
                                if selectedUsernames.contains(member.username) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 22))
                                        .foregroundStyle(VostokColors.accent)
                                } else {
                                    Image(systemName: "circle")
                                        .font(.system(size: 22))
                                        .foregroundStyle(VostokColors.labelSecondary.opacity(0.4))
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                if let error = membersViewModel.errorMessage {
                    Text(error)
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.danger)
                }
            }

            if let error = groupViewModel.lastError {
                Section {
                    Text(error)
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.danger)
                }
            }
        }
        .searchable(text: $searchQuery, prompt: "Search members")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if groupViewModel.isLoading {
                    ProgressView()
                } else {
                    Button("Create") {
                        createGroup()
                    }
                    .disabled(!canCreate)
                    .fontWeight(.semibold)
                }
            }
        }
        .vostokNavBar(title: "New Group", large: false)
        .task { await loadMembers() }
    }

    private func loadMembers() async {
        guard case let .authenticated(session) = appState.sessionState else { return }
        await membersViewModel.load(token: session.token, currentUsername: session.username)
    }

    private func createGroup() {
        guard case let .authenticated(session) = appState.sessionState else { return }
        let memberList = Array(selectedUsernames)
        Task {
            await groupViewModel.create(token: session.token, title: trimmedTitle, members: memberList)
            if groupViewModel.createdGroup != nil {
                dismiss()
            }
        }
    }
}

struct GroupInfoView: View {
    let chatID: String
    @EnvironmentObject private var appState: AppState
    @StateObject private var viewModel: GroupViewModel

    init(chatID: String, container: AppContainer) {
        self.chatID = chatID
        _viewModel = StateObject(
            wrappedValue: GroupViewModel(repository: container.chatRepository, apiClient: container.apiClient)
        )
    }

    var body: some View {
        List {
            Section("Group") {
                Text("Group ID: \(chatID)")
            }

            Section("Members") {
                ForEach(viewModel.members, id: \.userID) { member in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(member.username)
                                .font(VostokTypography.bodyEmphasized)
                            Spacer()
                            Text(member.role.capitalized)
                                .font(VostokTypography.caption)
                                .foregroundStyle(VostokColors.labelSecondary)
                        }
                        HStack(spacing: 12) {
                            Button("Make Admin") {
                                guard case let .authenticated(session) = appState.sessionState else { return }
                                Task {
                                    await viewModel.setRole(
                                        token: session.token,
                                        chatID: chatID,
                                        userID: member.userID,
                                        role: "admin"
                                    )
                                }
                            }
                            Button("Make Member") {
                                guard case let .authenticated(session) = appState.sessionState else { return }
                                Task {
                                    await viewModel.setRole(
                                        token: session.token,
                                        chatID: chatID,
                                        userID: member.userID,
                                        role: "member"
                                    )
                                }
                            }
                            Button("Remove", role: .destructive) {
                                guard case let .authenticated(session) = appState.sessionState else { return }
                                Task {
                                    await viewModel.remove(token: session.token, chatID: chatID, userID: member.userID)
                                }
                            }
                        }
                        .font(VostokTypography.footnote)
                    }
                    .padding(.vertical, 4)
                }
            }

            if let error = viewModel.lastError {
                Section {
                    Text(error)
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.danger)
                }
            }
        }
        .vostokNavBar(title: "Group Info", large: false)
        .task {
            guard case let .authenticated(session) = appState.sessionState else { return }
            await viewModel.loadMembers(token: session.token, chatID: chatID)
        }
    }
}
