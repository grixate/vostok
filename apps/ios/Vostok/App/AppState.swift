import Foundation
import Network
import SwiftUI

@MainActor
final class AppState: ObservableObject {
    enum SessionState: Equatable {
        case loggedOut
        case loading
        case authenticated(SessionContext)
    }

    struct SessionContext: Equatable {
        let token: String
        let userID: String
        let username: String
        let deviceID: String
    }

    enum BootstrapState: Equatable {
        case idle
        case loading
        case ready
        case failed(String)
    }

    @Published var sessionState: SessionState = .loading
    @Published var selectedChatID: String?
    @Published var bootstrapState: BootstrapState = .idle

    let container: AppContainer
    private var pendingDirectUsername: String?

    init(container: AppContainer) {
        self.container = container
    }

    func startup() async {
        bootstrapState = .loading
        sessionState = .loading

        do {
            _ = try await container.apiClient.health()
            _ = try await container.apiClient.bootstrap()
            bootstrapState = .ready
            restoreSession()
        } catch {
            bootstrapState = .failed(error.localizedDescription)
            sessionState = .loggedOut
        }
    }

    private func restoreSession() {
        if let session = KeychainSessionStore.shared.fetch() {
            sessionState = .authenticated(
                .init(token: session.token, userID: session.userID, username: session.username, deviceID: session.deviceID)
            )
            processPendingDirectUsernameIfPossible()
        } else {
            sessionState = .loggedOut
        }
    }

    func applyAuthenticatedSession(_ response: AuthSessionResponse, user: UserDTO, device: DeviceDTO) {
        KeychainSessionStore.shared.save(
            token: response.token,
            userID: user.id,
            username: user.username,
            deviceID: device.id
        )

        sessionState = .authenticated(
            .init(token: response.token, userID: user.id, username: user.username, deviceID: device.id)
        )
        processPendingDirectUsernameIfPossible()
    }

    func logout() {
        Task {
            await container.realtimeClient.disconnect()
        }
        KeychainSessionStore.shared.clear()
        sessionState = .loggedOut
        selectedChatID = nil
    }

    func requestChatNavigation(chatID: String) {
        let trimmed = chatID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        selectedChatID = trimmed
    }

    func consumeChatNavigation() {
        selectedChatID = nil
    }

    func handleOpenURL(_ url: URL) {
        guard let route = AppRouteParser.route(from: url) else { return }
        switch route {
        case let .chat(chatID):
            requestChatNavigation(chatID: chatID)
        case let .user(username):
            pendingDirectUsername = username
            processPendingDirectUsernameIfPossible()
        }
    }

    private func processPendingDirectUsernameIfPossible() {
        guard let username = pendingDirectUsername,
              case let .authenticated(session) = sessionState
        else {
            return
        }

        pendingDirectUsername = nil
        Task { [weak self] in
            guard let self else { return }
            await self.openDirectChat(username: username, token: session.token)
        }
    }

    private func openDirectChat(username: String, token: String) async {
        do {
            let chat = try await container.chatRepository.createDirectChat(token: token, username: username)
            requestChatNavigation(chatID: chat.id)
        } catch {
            // Keep this fail-safe and avoid breaking app startup/navigation flow.
        }
    }
}

@MainActor
final class NetworkPathMonitor: ObservableObject {
    @Published private(set) var isAvailable = true

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "chat.vostok.ios.network-monitor")
    private var hasStarted = false

    func start() {
        guard !hasStarted else { return }
        hasStarted = true
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                self?.isAvailable = path.status == .satisfied
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }
}
