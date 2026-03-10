import SwiftUI

struct ContactListView: View {
    @EnvironmentObject private var appState: AppState
    private let container: AppContainer
    @StateObject private var viewModel: ContactListViewModel
    @State private var openedChat: ChatDTO?
    @State private var isOpenedChatPresented = false

    init(container: AppContainer) {
        self.container = container
        _viewModel = StateObject(
            wrappedValue: ContactListViewModel(
                apiClient: container.apiClient,
                chatRepository: container.chatRepository
            )
        )
    }

    var body: some View {
        List {
            ForEach(viewModel.filteredMembers, id: \.id) { member in
                Button {
                    createDirectChat(username: member.username)
                } label: {
                    HStack(spacing: 10) {
                        VostokAvatar(title: member.username)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(member.username)
                                .font(VostokTypography.bodyEmphasized)
                            Text("@\(member.username)")
                                .font(VostokTypography.footnote)
                                .foregroundStyle(VostokColors.labelSecondary)
                        }
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            }

            if let error = viewModel.errorMessage {
                Section {
                    Text(error)
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.danger)
                }
            }
        }
        .searchable(text: $viewModel.searchQuery, prompt: "Search members")
        .refreshable {
            await loadIfPossible()
        }
        .overlay {
            if viewModel.isLoading {
                ProgressView()
            } else if viewModel.members.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "person.crop.circle.badge.questionmark")
                        .font(.system(size: 32))
                        .foregroundStyle(VostokColors.labelSecondary)
                    Text("No Members")
                        .font(VostokTypography.bodyEmphasized)
                        .foregroundStyle(VostokColors.labelSecondary)
                }
            }
        }
        .navigationDestination(isPresented: $isOpenedChatPresented) {
            if let chat = openedChat {
                ConversationView(chat: chat, container: container)
            } else {
                EmptyView()
            }
        }
        .vostokNavBar(title: "Members", large: true)
        .task {
            await loadIfPossible()
        }
    }

    @MainActor
    private func loadIfPossible() async {
        guard case let .authenticated(session) = appState.sessionState else { return }
        await viewModel.load(token: session.token, currentUsername: session.username)
    }

    private func createDirectChat(username: String) {
        guard case let .authenticated(session) = appState.sessionState else { return }
        Task {
            do {
                let chat = try await viewModel.createDirectChat(token: session.token, username: username)
                openedChat = chat
                isOpenedChatPresented = true
            } catch {
                viewModel.errorMessage = error.localizedDescription
            }
        }
    }
}
