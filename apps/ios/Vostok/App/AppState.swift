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
        /// The server this session belongs to (nil for legacy single-server).
        let serverId: String?

        init(token: String, userID: String, username: String, deviceID: String, serverId: String? = nil) {
            self.token = token
            self.userID = userID
            self.username = username
            self.deviceID = deviceID
            self.serverId = serverId
        }
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

    /// Per-server auth state (serverId → ServerAuth).
    @Published var serverAuthStates: [String: ServerAuth] = [:]
    /// Per-server connection status.
    @Published var serverConnectionStates: [String: ServerConnectionStatus] = [:]

    let container: AppContainer
    private var pendingDirectUsername: String?

    init(container: AppContainer) {
        self.container = container
    }

    func startup() async {
        bootstrapState = .loading
        sessionState = .loading

        // Load multi-server configuration
        container.loadServers()

        // Try to bootstrap the active server (or fallback)
        do {
            _ = try await container.apiClient.health()
            _ = try await container.apiClient.bootstrap()
            bootstrapState = .ready

            // Restore per-server auth
            restoreServerSessions()
            restoreSession()

            // Connect all authenticated servers
            await connectAuthenticatedServers()
        } catch {
            bootstrapState = .failed(error.localizedDescription)
            sessionState = .loggedOut
        }
    }

    private func restoreServerSessions() {
        let servers = container.serverStore.load()
        for server in servers {
            if let auth = server.auth {
                serverAuthStates[server.id] = auth
                serverConnectionStates[server.id] = .disconnected
            }
        }
    }

    private func restoreSession() {
        // Check multi-server auth first
        let servers = container.serverStore.load()
        if let activeServer = servers.first(where: { $0.enabled && $0.auth != nil }),
           let auth = activeServer.auth {
            container.activeServerId = activeServer.id
            sessionState = .authenticated(
                .init(
                    token: auth.token,
                    userID: auth.userID,
                    username: auth.username,
                    deviceID: auth.deviceID,
                    serverId: activeServer.id
                )
            )
            processPendingDirectUsernameIfPossible()
            return
        }

        // Fall back to legacy Keychain session
        if let session = KeychainSessionStore.shared.fetch() {
            sessionState = .authenticated(
                .init(token: session.token, userID: session.userID, username: session.username, deviceID: session.deviceID)
            )
            processPendingDirectUsernameIfPossible()
        } else {
            sessionState = .loggedOut
        }
    }

    private func connectAuthenticatedServers() async {
        for (serverId, auth) in serverAuthStates {
            guard let context = container.context(for: serverId) else { continue }
            serverConnectionStates[serverId] = .connecting
            await context.realtimeClient.connect(token: auth.token)
            serverConnectionStates[serverId] = .connected
            context.connectionStatus = .connected
        }
    }

    func applyAuthenticatedSession(_ response: AuthSessionResponse, user: UserDTO, device: DeviceDTO) {
        // Save to legacy Keychain for backward compatibility
        KeychainSessionStore.shared.save(
            token: response.token,
            userID: user.id,
            username: user.username,
            deviceID: device.id
        )

        // Update multi-server state if there's an active server
        if let serverId = container.activeServerId {
            let auth = ServerAuth(
                token: response.token,
                userID: user.id,
                username: user.username,
                deviceID: device.id
            )
            serverAuthStates[serverId] = auth

            // Persist auth to server entry
            var servers = container.serverStore.load()
            if let index = servers.firstIndex(where: { $0.id == serverId }) {
                servers[index].auth = auth
                servers[index].device = ServerDevice(deviceID: device.id, identityPublicKey: "")
                servers[index].lastConnectedAt = ISO8601DateFormatter().string(from: Date())
                container.serverStore.save(servers)
            }

            sessionState = .authenticated(
                .init(
                    token: response.token,
                    userID: user.id,
                    username: user.username,
                    deviceID: device.id,
                    serverId: serverId
                )
            )
        } else {
            sessionState = .authenticated(
                .init(token: response.token, userID: user.id, username: user.username, deviceID: device.id)
            )
        }

        processPendingDirectUsernameIfPossible()
    }

    /// Authenticate to a specific server (for multi-server add flow).
    func applyServerAuth(serverId: String, auth: ServerAuth) {
        serverAuthStates[serverId] = auth

        // Persist
        var servers = container.serverStore.load()
        if let index = servers.firstIndex(where: { $0.id == serverId }) {
            servers[index].auth = auth
            servers[index].lastConnectedAt = ISO8601DateFormatter().string(from: Date())
            container.serverStore.save(servers)
        }

        // If this is the first/only server, make it active
        if container.activeServerId == nil || container.serverContexts.count == 1 {
            container.activeServerId = serverId
            sessionState = .authenticated(
                .init(
                    token: auth.token,
                    userID: auth.userID,
                    username: auth.username,
                    deviceID: auth.deviceID,
                    serverId: serverId
                )
            )
        }
    }

    func logout() {
        Task {
            await container.disconnectAll()
        }

        // Clear all server auth
        serverAuthStates.removeAll()
        serverConnectionStates.removeAll()

        // Clear server entries' auth
        var servers = container.serverStore.load()
        for i in servers.indices {
            servers[i].auth = nil
            servers[i].device = nil
        }
        container.serverStore.save(servers)

        // Clear legacy Keychain
        KeychainSessionStore.shared.clear()
        sessionState = .loggedOut
        selectedChatID = nil
    }

    /// Logs out from a specific server only.
    func logoutServer(id: String) {
        if let context = container.context(for: id) {
            Task { await context.realtimeClient.disconnect() }
        }

        serverAuthStates.removeValue(forKey: id)
        serverConnectionStates.removeValue(forKey: id)

        var servers = container.serverStore.load()
        if let index = servers.firstIndex(where: { $0.id == id }) {
            servers[index].auth = nil
            servers[index].device = nil
            container.serverStore.save(servers)
        }

        // If we logged out of the active server, switch to another
        if container.activeServerId == id {
            let remaining = serverAuthStates.keys.first
            container.activeServerId = remaining
            if let nextId = remaining, let auth = serverAuthStates[nextId] {
                sessionState = .authenticated(
                    .init(token: auth.token, userID: auth.userID, username: auth.username, deviceID: auth.deviceID, serverId: nextId)
                )
            } else {
                sessionState = .loggedOut
            }
        }
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
        case let .invite(code):
            joinByInviteCode(code)
        }
    }

    private func joinByInviteCode(_ code: String) {
        guard case let .authenticated(session) = sessionState else { return }
        Task {
            do {
                let response = try await container.apiClient.joinByInviteCode(token: session.token, code: code)
                requestChatNavigation(chatID: response.chat.id)
            } catch {
                // Best-effort — user will see the error in the chat list
            }
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
            // Best-effort — don't break navigation flow.
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
