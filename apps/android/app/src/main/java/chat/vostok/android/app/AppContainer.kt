package chat.vostok.android.app

import android.content.Context
import chat.vostok.android.BuildConfig
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
import chat.vostok.android.core.repository.MessageRepository
import chat.vostok.android.core.repository.MediaRepository
import chat.vostok.android.core.storage.MediaCache
import chat.vostok.android.core.storage.SecurePreferencesFactory
import chat.vostok.android.core.storage.SessionStore
import chat.vostok.android.core.storage.VostokDatabase
import java.security.MessageDigest
import java.util.Base64

class AppContainer(context: Context) {
    private val tokenProvider = SessionTokenProvider()

    val keyManager = KeyManager(context)
    val sessionStore = SessionStore(context)
    val apiClient = ApiClient(baseUrl = BuildConfig.VOSTOK_BASE_URL) { tokenProvider.get() }
    val database = VostokDatabase.getInstance(context, deriveDatabasePassphrase())
    val mediaCache = MediaCache(context)
    val secureStorageStatus = SecurePreferencesFactory.currentStatus(context)
    val signingStorageSummary = keyManager.signingStorageSummary()
    val webSocketManager = WebSocketManager(socketUrl = BuildConfig.VOSTOK_SOCKET_URL)
    val signalSessionRuntime = SignalSessionRuntime(
        apiClient = apiClient,
        signalSessionDao = database.signalSessionDao(),
        keyManager = keyManager,
        sessionStore = sessionStore
    )

    val authRepository = AuthRepository(
        apiClient = apiClient,
        keyManager = keyManager,
        sessionStore = sessionStore,
        tokenSetter = tokenProvider::set
    )

    val chatRepository = ChatRepository(
        apiClient = apiClient,
        chatDao = database.chatDao(),
        messageDao = database.messageDao()
    )

    val messageRepository = MessageRepository(
        apiClient = apiClient,
        messageDao = database.messageDao(),
        pendingOutboxDao = database.pendingOutboxDao(),
        sessionRuntime = signalSessionRuntime
    )

    val contactRepository = ContactRepository(apiClient = apiClient)
    val deviceRepository = DeviceRepository(apiClient = apiClient)
    val groupRepository = GroupRepository(apiClient = apiClient)
    val callRepository = CallRepository(apiClient = apiClient)
    val mediaRepository = MediaRepository(apiClient = apiClient, mediaCache = mediaCache)

    init {
        tokenProvider.set(sessionStore.load()?.token)
    }

    private fun deriveDatabasePassphrase(): ByteArray {
        val identityPublicKeyBase64 = keyManager.publicKeyBase64()
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(Base64.getDecoder().decode(identityPublicKeyBase64))
        return digest
    }
}
