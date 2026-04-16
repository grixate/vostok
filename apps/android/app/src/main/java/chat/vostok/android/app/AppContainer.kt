package chat.vostok.android.app

import android.content.Context
import chat.vostok.android.BuildConfig
import chat.vostok.android.core.crypto.KeyManager
import chat.vostok.android.core.crypto.SignalSessionRuntime
import chat.vostok.android.core.multiserver.ServerConnectionStatus
import chat.vostok.android.core.multiserver.ServerContext
import chat.vostok.android.core.multiserver.ServerDatabaseManager
import chat.vostok.android.core.multiserver.ServerEntry
import chat.vostok.android.core.multiserver.ServerStore
import chat.vostok.android.core.multiserver.serverIdFrom
import chat.vostok.android.core.network.ApiClient
import chat.vostok.android.core.network.WebSocketManager
import chat.vostok.android.core.repository.AuthRepository
import chat.vostok.android.core.repository.CallRepository
import chat.vostok.android.core.repository.ChatRepository
import chat.vostok.android.core.repository.ContactRepository
import chat.vostok.android.core.repository.DeviceRepository
import chat.vostok.android.core.repository.GroupRepository
import chat.vostok.android.core.repository.MessageRepository
import chat.vostok.android.core.repository.MediaRepository
import chat.vostok.android.core.storage.MediaCache
import chat.vostok.android.core.storage.SecurePreferencesFactory
import chat.vostok.android.core.storage.SessionStore
import chat.vostok.android.core.storage.VostokDatabase
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.MessageDigest
import java.util.Base64

class AppContainer(private val context: Context) {
    private val tokenProvider = SessionTokenProvider()

    val keyManager = KeyManager(context)
    val sessionStore = SessionStore(context)
    val serverStore = ServerStore(context)
    val secureStorageStatus = SecurePreferencesFactory.currentStatus(context)
    val signingStorageSummary = keyManager.signingStorageSummary()

    // MARK: – Multi-server state
    private val _serverContexts = mutableMapOf<String, ServerContext>()
    val serverContexts: Map<String, ServerContext> get() = _serverContexts

    private val _activeServerId = MutableStateFlow<String?>(null)
    val activeServerId: StateFlow<String?> = _activeServerId.asStateFlow()

    val activeContext: ServerContext?
        get() = _activeServerId.value?.let { _serverContexts[it] }

    // MARK: – Legacy compatibility (delegates to active server context or fallback)
    private val fallbackApiClient: ApiClient
    private val fallbackWebSocket: WebSocketManager
    private val fallbackDatabase: VostokDatabase
    private val fallbackAuthRepository: AuthRepository
    private val fallbackChatRepository: ChatRepository
    private val fallbackMessageRepository: MessageRepository
    private val fallbackContactRepository: ContactRepository
    private val fallbackDeviceRepository: DeviceRepository
    private val fallbackGroupRepository: GroupRepository
    private val fallbackCallRepository: CallRepository
    private val fallbackMediaRepository: MediaRepository
    private val fallbackSignalRuntime: SignalSessionRuntime

    val apiClient: ApiClient get() = activeContext?.apiClient ?: fallbackApiClient
    val webSocketManager: WebSocketManager get() = activeContext?.webSocketManager ?: fallbackWebSocket
    val database: VostokDatabase get() = activeContext?.database ?: fallbackDatabase
    val authRepository: AuthRepository get() = activeContext?.authRepository ?: fallbackAuthRepository
    val chatRepository: ChatRepository get() = activeContext?.chatRepository ?: fallbackChatRepository
    val messageRepository: MessageRepository get() = activeContext?.messageRepository ?: fallbackMessageRepository
    val contactRepository: ContactRepository get() = activeContext?.contactRepository ?: fallbackContactRepository
    val deviceRepository: DeviceRepository get() = activeContext?.deviceRepository ?: fallbackDeviceRepository
    val groupRepository: GroupRepository get() = activeContext?.groupRepository ?: fallbackGroupRepository
    val callRepository: CallRepository get() = activeContext?.callRepository ?: fallbackCallRepository
    val mediaRepository: MediaRepository get() = activeContext?.mediaRepository ?: fallbackMediaRepository
    val signalSessionRuntime: SignalSessionRuntime get() = activeContext?.signalSessionRuntime ?: fallbackSignalRuntime
    val mediaCache = MediaCache(context)

    init {
        // Create fallback services from BuildConfig (legacy single-server)
        fallbackApiClient = ApiClient(baseUrl = BuildConfig.VOSTOK_BASE_URL) { tokenProvider.get() }
        fallbackWebSocket = WebSocketManager(socketUrl = BuildConfig.VOSTOK_SOCKET_URL)
        fallbackDatabase = VostokDatabase.getInstance(context, deriveDatabasePassphrase())

        fallbackSignalRuntime = SignalSessionRuntime(
            apiClient = fallbackApiClient,
            signalSessionDao = fallbackDatabase.signalSessionDao(),
            keyManager = keyManager,
            sessionStore = sessionStore,
        )
        fallbackAuthRepository = AuthRepository(
            apiClient = fallbackApiClient,
            keyManager = keyManager,
            sessionStore = sessionStore,
            tokenSetter = tokenProvider::set,
        )
        fallbackChatRepository = ChatRepository(
            apiClient = fallbackApiClient,
            chatDao = fallbackDatabase.chatDao(),
            messageDao = fallbackDatabase.messageDao(),
        )
        fallbackMessageRepository = MessageRepository(
            apiClient = fallbackApiClient,
            messageDao = fallbackDatabase.messageDao(),
            pendingOutboxDao = fallbackDatabase.pendingOutboxDao(),
            sessionRuntime = fallbackSignalRuntime,
        )
        fallbackContactRepository = ContactRepository(apiClient = fallbackApiClient)
        fallbackDeviceRepository = DeviceRepository(apiClient = fallbackApiClient)
        fallbackGroupRepository = GroupRepository(apiClient = fallbackApiClient)
        fallbackCallRepository = CallRepository(apiClient = fallbackApiClient)
        fallbackMediaRepository = MediaRepository(apiClient = fallbackApiClient, mediaCache = mediaCache)

        tokenProvider.set(sessionStore.load()?.token)
    }

    // MARK: – Server lifecycle

    fun loadServers() {
        var servers = serverStore.load()
        if (servers.isEmpty()) {
            servers = serverStore.migrateFromLegacySingleServer(sessionStore)
        }

        for (server in servers.filter { it.enabled }) {
            if (server.id !in _serverContexts) {
                createContext(server)
            }
        }

        if (_activeServerId.value == null) {
            _activeServerId.value = servers.firstOrNull { it.enabled }?.id
        }
    }

    fun createContext(entry: ServerEntry): ServerContext? {
        return try {
            val ctx = ServerContext(entry, context, keyManager, sessionStore)
            _serverContexts[entry.id] = ctx
            ctx
        } catch (e: Exception) {
            android.util.Log.e("AppContainer", "Failed to create context for ${entry.label}: $e")
            null
        }
    }

    fun removeServer(id: String) {
        _serverContexts.remove(id)
        serverStore.remove(id)
        ServerDatabaseManager.removeDatabaseFiles(context, id)
        if (_activeServerId.value == id) {
            _activeServerId.value = serverStore.load().firstOrNull { it.enabled }?.id
        }
    }

    fun contextForServer(serverId: String): ServerContext? = _serverContexts[serverId]

    fun contextForChat(qualifiedChatId: String): ServerContext? {
        val serverId = serverIdFrom(qualifiedChatId) ?: return activeContext
        return _serverContexts[serverId] ?: activeContext
    }

    fun setActiveServer(serverId: String) {
        _activeServerId.value = serverId
    }

    private fun deriveDatabasePassphrase(): ByteArray {
        val identityPublicKeyBase64 = keyManager.publicKeyBase64()
        return MessageDigest.getInstance("SHA-256")
            .digest(Base64.getDecoder().decode(identityPublicKeyBase64))
    }
}
