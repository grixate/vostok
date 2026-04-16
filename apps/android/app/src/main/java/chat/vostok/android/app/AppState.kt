package chat.vostok.android.app

import chat.vostok.android.core.multiserver.ServerAuth
import chat.vostok.android.core.multiserver.ServerConnectionStatus
import chat.vostok.android.core.storage.StoredSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AppSessionState(
    val token: String? = null,
    val userId: String? = null,
    val deviceId: String? = null,
    val username: String? = null,
    val expiresAt: String? = null,
    /** The server this session belongs to (null for legacy single-server). */
    val serverId: String? = null,
) {
    val isAuthenticated: Boolean get() = !token.isNullOrBlank()
}

class AppState(initialSession: StoredSession?) {
    private val _session = MutableStateFlow(
        AppSessionState(
            token = initialSession?.token,
            userId = initialSession?.userId,
            deviceId = initialSession?.deviceId,
            username = initialSession?.username,
            expiresAt = initialSession?.expiresAt,
        )
    )

    val session: StateFlow<AppSessionState> = _session.asStateFlow()

    private val _pendingOpenChatId = MutableStateFlow<String?>(null)
    val pendingOpenChatId: StateFlow<String?> = _pendingOpenChatId.asStateFlow()

    /** Per-server auth states. */
    private val _serverAuthStates = MutableStateFlow<Map<String, ServerAuth>>(emptyMap())
    val serverAuthStates: StateFlow<Map<String, ServerAuth>> = _serverAuthStates.asStateFlow()

    /** Per-server connection statuses. */
    private val _serverConnectionStates = MutableStateFlow<Map<String, ServerConnectionStatus>>(emptyMap())
    val serverConnectionStates: StateFlow<Map<String, ServerConnectionStatus>> = _serverConnectionStates.asStateFlow()

    fun setSession(value: StoredSession?, serverId: String? = null) {
        _session.value = AppSessionState(
            token = value?.token,
            userId = value?.userId,
            deviceId = value?.deviceId,
            username = value?.username,
            expiresAt = value?.expiresAt,
            serverId = serverId,
        )
    }

    fun setServerAuth(serverId: String, auth: ServerAuth) {
        _serverAuthStates.value = _serverAuthStates.value + (serverId to auth)
    }

    fun removeServerAuth(serverId: String) {
        _serverAuthStates.value = _serverAuthStates.value - serverId
        _serverConnectionStates.value = _serverConnectionStates.value - serverId
    }

    fun setServerConnectionStatus(serverId: String, status: ServerConnectionStatus) {
        _serverConnectionStates.value = _serverConnectionStates.value + (serverId to status)
    }

    fun clearAllServerStates() {
        _serverAuthStates.value = emptyMap()
        _serverConnectionStates.value = emptyMap()
    }

    fun requestOpenChat(chatId: String?) {
        _pendingOpenChatId.value = chatId?.trim()?.takeIf { it.isNotBlank() }
    }

    fun consumeOpenChatRequest() {
        _pendingOpenChatId.value = null
    }
}
