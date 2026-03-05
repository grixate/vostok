import Foundation

final class AppContainer {
    let environment: AppEnvironment
    let apiClient: VostokAPIClientProtocol
    let realtimeClient: PhoenixRealtimeClientProtocol
    let cryptoProvider: CryptoProviderProtocol
    let chatRepository: ChatRepository
    let messageRepository: MessageRepository
    let callRepository: CallRepository
    let mediaRepository: MediaRepository
    let mediaTransferService: MediaTransferService
    let database: VostokDatabase
    let signalSessionRuntime: SignalSessionRuntimeProtocol

    init(environment: AppEnvironment) {
        self.environment = environment

        let api = APIClient(baseURL: environment.baseURL)
        let realtime = PhoenixRealtimeClient(socketURL: environment.socketURL)
        let crypto = SignalCryptoProvider()
        let database: VostokDatabase
        do {
            database = try VostokDatabase()
        } catch {
            fatalError("Failed to initialize SQLCipher database: \(error.localizedDescription)")
        }
        let chatRepo = InMemoryChatRepository(apiClient: api, database: database)
        let msgRepo = InMemoryMessageRepository(apiClient: api, database: database)
        let callRepo = NetworkCallRepository(apiClient: api)
        let mediaRepo = NetworkMediaRepository(apiClient: api)
        let mediaTransfer = MediaTransferService(repository: mediaRepo)
        let sessionRuntime = SignalSessionRuntime(apiClient: api, database: database)

        self.apiClient = api
        self.realtimeClient = realtime
        self.cryptoProvider = crypto
        self.chatRepository = chatRepo
        self.messageRepository = msgRepo
        self.callRepository = callRepo
        self.mediaRepository = mediaRepo
        self.mediaTransferService = mediaTransfer
        self.database = database
        self.signalSessionRuntime = sessionRuntime
    }
}
