package chat.vostok.android.core.multiserver

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import chat.vostok.android.app.SessionTokenProvider
import chat.vostok.android.core.crypto.KeyManager
import chat.vostok.android.core.crypto.SignalSessionRuntime
import chat.vostok.android.core.network.ApiClient
import chat.vostok.android.core.network.WebSocketManager
import chat.vostok.android.core.repository.AuthRepository
import chat.vostok.android.core.repository.CallRepository
import chat.vostok.android.core.repository.ChatRepository
import chat.vostok.android.core.repository.ContactRepository
import chat.vostok.android.core.repository.DeviceRepository
import chat.vostok.android.core.repository.GroupRepository
import chat.vostok.android.core.repository.MediaRepository
import chat.vostok.android.core.repository.MessageRepository
import chat.vostok.android.core.storage.MediaCache
import chat.vostok.android.core.storage.SessionStore
import chat.vostok.android.core.storage.VostokDatabase
import java.security.SecureRandom
import java.util.Base64

/**
 * Holds all service instances scoped to a single server.
 * Each connected server gets its own context with independent API client,
 * WebSocket, database, and Signal session runtime.
 */
class ServerContext(
    val entry: ServerEntry,
    context: Context,
    keyManager: KeyManager,
    sessionStore: SessionStore,
) {
    private val tokenProvider = SessionTokenProvider()
    val apiClient: ApiClient
    val webSocketManager: WebSocketManager
    val database: VostokDatabase
    val signalSessionRuntime: SignalSessionRuntime
    val chatRepository: ChatRepository
    val messageRepository: MessageRepository
    val contactRepository: ContactRepository
    val deviceRepository: DeviceRepository
    val groupRepository: GroupRepository
    val callRepository: CallRepository
    val mediaRepository: MediaRepository
    val authRepository: AuthRepository

    var connectionStatus: ServerConnectionStatus = ServerConnectionStatus.DISCONNECTED

    init {
        val socketUrl = socketUrlFrom(entry.url)
            ?: throw IllegalArgumentException("Invalid server URL: ${entry.url}")

        apiClient = ApiClient(baseUrl = entry.url) { tokenProvider.get() }
        webSocketManager = WebSocketManager(socketUrl = socketUrl)

        // Per-server database with its own passphrase
        val passphrase = ServerDatabaseManager.loadOrCreatePassphrase(context, entry.id)
        database = VostokDatabase.create(context, "vostok_${sanitizeId(entry.id)}", passphrase)

        val mediaCache = MediaCache(context)

        signalSessionRuntime = SignalSessionRuntime(
            apiClient = apiClient,
            signalSessionDao = database.signalSessionDao(),
            keyManager = keyManager,
            sessionStore = sessionStore,
        )

        authRepository = AuthRepository(
            apiClient = apiClient,
            keyManager = keyManager,
            sessionStore = sessionStore,
            tokenSetter = tokenProvider::set,
        )

        chatRepository = ChatRepository(
            apiClient = apiClient,
            chatDao = database.chatDao(),
            messageDao = database.messageDao(),
        )

        messageRepository = MessageRepository(
            apiClient = apiClient,
            messageDao = database.messageDao(),
            pendingOutboxDao = database.pendingOutboxDao(),
            sessionRuntime = signalSessionRuntime,
        )

        contactRepository = ContactRepository(apiClient = apiClient)
        deviceRepository = DeviceRepository(apiClient = apiClient)
        groupRepository = GroupRepository(apiClient = apiClient)
        callRepository = CallRepository(apiClient = apiClient)
        mediaRepository = MediaRepository(apiClient = apiClient, mediaCache = mediaCache)

        // Set the auth token if available
        entry.auth?.let { tokenProvider.set(it.token) }
    }

    private fun sanitizeId(id: String): String =
        id.replace(Regex("[^a-zA-Z0-9_-]"), "_")
}

/**
 * Manages per-server SQLCipher database passphrases in EncryptedSharedPreferences.
 */
object ServerDatabaseManager {
    private const val PREFS_NAME = "vostok_server_db_keys"

    fun loadOrCreatePassphrase(context: Context, serverId: String): ByteArray {
        val prefs = getEncryptedPrefs(context)
        val key = "passphrase_$serverId"

        val existing = prefs.getString(key, null)
        if (existing != null) {
            return Base64.getDecoder().decode(existing)
        }

        // Generate a new 32-byte random passphrase
        val passphrase = ByteArray(32)
        SecureRandom().nextBytes(passphrase)
        val encoded = Base64.getEncoder().encodeToString(passphrase)

        prefs.edit().putString(key, encoded).apply()

        // Verify the save
        val verified = prefs.getString(key, null)
        if (verified == null) {
            android.util.Log.e("ServerDatabaseManager",
                "CRITICAL: Failed to save passphrase for server $serverId")
        }

        return passphrase
    }

    fun removePassphrase(context: Context, serverId: String) {
        val prefs = getEncryptedPrefs(context)
        prefs.edit().remove("passphrase_$serverId").apply()
    }

    private fun getEncryptedPrefs(context: Context) =
        EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )

    fun removeDatabaseFiles(context: Context, serverId: String) {
        val sanitized = serverId.replace(Regex("[^a-zA-Z0-9_-]"), "_")
        val dbName = "vostok_$sanitized"
        context.deleteDatabase(dbName)
        removePassphrase(context, serverId)
    }
}
