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
            wrappedValue: ContactListViewModel(chatRepository: container.chatRepository)
        )
    }

    var body: some View {
        List {
            ForEach(viewModel.filteredContacts, id: \.self) { username in
                Button {
                    createDirectChat(username: username)
                } label: {
                    HStack(spacing: 10) {
                        VostokAvatar(title: username)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(username)
                                .font(VostokTypography.bodyEmphasized)
                            Text("@\(username)")
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
        .searchable(text: $viewModel.searchQuery, prompt: "Search contacts")
        .refreshable {
            await loadIfPossible()
        }
        .overlay {
            if viewModel.isLoading {
                ProgressView()
            } else if viewModel.contacts.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "person.crop.circle.badge.questionmark")
                        .font(.system(size: 32))
                        .foregroundStyle(VostokColors.labelSecondary)
                    Text("No Contacts")
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
        .vostokNavBar(title: "Contacts", large: true)
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
