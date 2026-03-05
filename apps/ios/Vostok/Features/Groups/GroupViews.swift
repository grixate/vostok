import SwiftUI

struct CreateGroupView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var members = ""
    @StateObject private var viewModel: GroupViewModel

    init(container: AppContainer) {
        _viewModel = StateObject(
            wrappedValue: GroupViewModel(repository: container.chatRepository, apiClient: container.apiClient)
        )
    }

    var body: some View {
        Form {
            TextField("Group title", text: $title)
            TextField("Members (comma-separated)", text: $members)
            Button("Create") {
                guard case let .authenticated(session) = appState.sessionState else { return }
                let list = members
                    .split(separator: ",")
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                Task {
                    await viewModel.create(token: session.token, title: title, members: list)
                }
            }
                .buttonStyle(VostokPrimaryButtonStyle())
                .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isLoading)

            if let created = viewModel.createdGroup {
                Section {
                    Text("Created: \(created.title)")
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.online)
                    Button("Done") {
                        dismiss()
                    }
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
        .vostokNavBar(title: "New Group", large: false)
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
