package chat.vostok.android.app

import chat.vostok.android.core.storage.StoredSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AppSessionState(
    val token: String? = null,
    val userId: String? = null,
    val deviceId: String? = null,
    val username: String? = null,
    val expiresAt: String? = null
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
            expiresAt = initialSession?.expiresAt
        )
    )

    val session: StateFlow<AppSessionState> = _session.asStateFlow()

    fun setSession(value: StoredSession?) {
        _session.value = AppSessionState(
            token = value?.token,
            userId = value?.userId,
            deviceId = value?.deviceId,
            username = value?.username,
            expiresAt = value?.expiresAt
        )
    }
}
