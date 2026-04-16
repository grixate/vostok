import Foundation

final class AppContainer: ObservableObject {
    let environment: AppEnvironment
    let cryptoProvider: CryptoProviderProtocol
    let serverStore: ServerStore

    /// All configured servers and their service contexts.
    @Published private(set) var serverContexts: [String: ServerContext] = [:]
    /// The currently active server ID.
    @Published var activeServerId: String?

    /// The active server's context (convenience for feature views).
    var activeContext: ServerContext? {
        guard let id = activeServerId else { return nil }
        return serverContexts[id]
    }

    // MARK: – Legacy compatibility (delegate to active server context)

    var apiClient: VostokAPIClientProtocol { activeContext?.apiClient ?? fallbackAPIClient }
    var realtimeClient: PhoenixRealtimeClientProtocol { activeContext?.realtimeClient ?? fallbackRealtimeClient }
    var chatRepository: ChatRepository { activeContext?.chatRepository ?? fallbackChatRepo }
    var messageRepository: MessageRepository { activeContext?.messageRepository ?? fallbackMsgRepo }
    var callRepository: CallRepository { activeContext?.callRepository ?? fallbackCallRepo }
    var mediaRepository: MediaRepository { activeContext?.mediaRepository ?? fallbackMediaRepo }
    var mediaTransferService: MediaTransferService { activeContext?.mediaTransferService ?? fallbackMediaTransfer }
    var database: VostokDatabase { activeContext?.database ?? fallbackDatabase }
    var signalSessionRuntime: SignalSessionRuntimeProtocol { activeContext?.signalSessionRuntime ?? fallbackSessionRuntime }

    // MARK: – Fallbacks (used when no server is active, e.g. during onboarding)
    private let fallbackAPIClient: VostokAPIClientProtocol
    private let fallbackRealtimeClient: PhoenixRealtimeClientProtocol
    private let fallbackDatabase: VostokDatabase
    private let fallbackChatRepo: ChatRepository
    private let fallbackMsgRepo: MessageRepository
    private let fallbackCallRepo: CallRepository
    private let fallbackMediaRepo: MediaRepository
    private let fallbackMediaTransfer: MediaTransferService
    private let fallbackSessionRuntime: SignalSessionRuntimeProtocol

    init(environment: AppEnvironment) {
        self.environment = environment
        self.cryptoProvider = SignalCryptoProvider()
        self.serverStore = ServerStore()

        // Create fallback services using the Environment.plist URL
        let api = APIClient(baseURL: environment.baseURL)
        let realtime = PhoenixRealtimeClient(socketURL: environment.socketURL)
        let database: VostokDatabase
        do {
            database = try VostokDatabase()
        } catch {
            fatalError("Failed to initialize fallback SQLCipher database: \(error.localizedDescription)")
        }

        self.fallbackAPIClient = api
        self.fallbackRealtimeClient = realtime
        self.fallbackDatabase = database
        self.fallbackChatRepo = InMemoryChatRepository(apiClient: api, database: database)
        self.fallbackMsgRepo = InMemoryMessageRepository(apiClient: api, database: database)
        self.fallbackCallRepo = NetworkCallRepository(apiClient: api)
        self.fallbackMediaRepo = NetworkMediaRepository(apiClient: api)
        self.fallbackMediaTransfer = MediaTransferService(repository: NetworkMediaRepository(apiClient: api))
        self.fallbackSessionRuntime = SignalSessionRuntime(apiClient: api, database: database)
    }

    // MARK: – Server lifecycle

    /// Loads servers from disk and creates contexts for each.
    /// Migrates from legacy single-server if needed.
    func loadServers() {
        var servers = serverStore.load()

        // Migrate from single-server if this is the first multi-server launch
        if servers.isEmpty {
            servers = serverStore.migrateFromLegacySingleServer(environment: environment)
        }

        for server in servers where server.enabled {
            if serverContexts[server.id] == nil {
                createContext(for: server)
            }
        }

        // Set active server to first one if none selected
        if activeServerId == nil, let first = servers.first(where: { $0.enabled }) {
            activeServerId = first.id
        }
    }

    /// Creates and registers a ServerContext for the given entry.
    @discardableResult
    func createContext(for entry: ServerEntry) -> ServerContext? {
        do {
            let context = try ServerContext(entry: entry)
            serverContexts[entry.id] = context
            return context
        } catch {
            print("[MultiServer] Failed to create context for \(entry.label): \(error)")
            return nil
        }
    }

    /// Removes a server and its context, database, and credentials.
    func removeServer(id: String) {
        if let context = serverContexts[id] {
            Task { await context.realtimeClient.disconnect() }
        }
        serverContexts.removeValue(forKey: id)
        _ = serverStore.remove(id: id)
        ServerDatabaseManager.removeDatabase(for: id)

        if activeServerId == id {
            activeServerId = serverStore.load().first(where: { $0.enabled })?.id
        }
    }

    /// Returns the context for a specific server, or nil if not loaded.
    func context(for serverId: String) -> ServerContext? {
        serverContexts[serverId]
    }

    /// Returns the context that owns a qualified chat ID.
    func context(forQualifiedChatId qualifiedId: String) -> ServerContext? {
        guard let serverId = QualifiedChatIdParser.serverId(from: qualifiedId) else {
            return activeContext
        }
        return serverContexts[serverId] ?? activeContext
    }

    /// Connects all enabled servers (establishes WebSocket connections).
    func connectAll(getToken: (String) -> String?) async {
        for (serverId, context) in serverContexts {
            guard let token = getToken(serverId) else { continue }
            context.connectionStatus = .connecting
            await context.realtimeClient.connect(token: token)
            context.connectionStatus = .connected
        }
    }

    /// Disconnects all server WebSocket connections.
    func disconnectAll() async {
        for (_, context) in serverContexts {
            await context.realtimeClient.disconnect()
            context.connectionStatus = .disconnected
        }
    }

    /// Returns merged and sorted chats from all connected servers.
    func allMergedChats() -> [MergedChatSummary] {
        var all: [MergedChatSummary] = []
        let servers = serverStore.load()

        for server in servers where server.enabled {
            guard let context = serverContexts[server.id] else { continue }
            let chats = context.database.loadChats()
            all.append(contentsOf: chats.map { MergedChatSummary.from(server: server, chat: $0) })
        }

        return sortMergedChats(all)
    }
}
