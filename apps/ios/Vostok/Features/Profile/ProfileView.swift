import SwiftUI
import UIKit

@MainActor
final class ProfileViewModel: ObservableObject {
    @Published var user: UserDTO?
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let apiClient: VostokAPIClientProtocol

    init(apiClient: VostokAPIClientProtocol) {
        self.apiClient = apiClient
    }

    func load(token: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let me = try await apiClient.me(token: token)
            user = me.user
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct ProfileView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var viewModel: ProfileViewModel
    @StateObject private var settingsViewModel = SettingsViewModel()
    private let container: AppContainer
    @State private var savedMessagesChat: ChatDTO?
    @State private var navigateToSaved = false

    init(container: AppContainer) {
        _viewModel = StateObject(wrappedValue: ProfileViewModel(apiClient: container.apiClient))
        self.container = container
    }

    var body: some View {
        List {
            // Avatar section
            Section {
                VStack(spacing: 10) {
                    Button {
                        Task {
                            guard case let .authenticated(session) = appState.sessionState else { return }
                            savedMessagesChat = try? await container.chatRepository.ensureSelfChat(token: session.token)
                            if savedMessagesChat != nil { navigateToSaved = true }
                        }
                    } label: {
                        VostokAvatar(title: avatarTitle, size: 100, isOnline: true)
                    }
                    .buttonStyle(.plain)
                    Text(displayName)
                        .font(VostokTypography.title)
                        .foregroundStyle(VostokColors.labelPrimary)
                    Text("@\(usernameValue)")
                        .font(VostokTypography.body)
                        .foregroundStyle(VostokColors.labelSecondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
                .listRowBackground(Color.clear)
            }

            // Shared media
            Section {
                ProfileMediaSection(items: [])
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }

            // Navigation
            Section {
                NavigationLink("Linked Devices") {
                    DevicesView(container: container)
                }
                NavigationLink("Privacy & Security") {
                    PrivacySettingsView(viewModel: settingsViewModel)
                }
            }

            // Logout
            Section {
                Button("Log Out", role: .destructive) {
                    appState.logout()
                }
            }
        }
        .vostokNavBar(title: "Profile", large: false)
        .navigationDestination(isPresented: $navigateToSaved) {
            if let chat = savedMessagesChat {
                ConversationView(chat: chat, container: container)
            }
        }
        .task {
            guard case let .authenticated(session) = appState.sessionState else { return }
            await viewModel.load(token: session.token)
        }
        .overlay {
            if viewModel.isLoading {
                ProgressView()
            }
        }
    }

    private var avatarTitle: String {
        let value = usernameValue.trimmingCharacters(in: .whitespacesAndNewlines)
        return String(value.prefix(1)).uppercased()
    }

    private var displayName: String {
        usernameValue
    }

    private var usernameValue: String {
        if let explicit = viewModel.user?.username, !explicit.isEmpty {
            return explicit
        }
        if case let .authenticated(session) = appState.sessionState, !session.username.isEmpty {
            return session.username
        }
        return "unknown"
    }
}
