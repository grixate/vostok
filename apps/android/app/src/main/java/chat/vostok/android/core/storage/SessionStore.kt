package chat.vostok.android.core.storage

import android.content.Context

data class StoredSession(
    val token: String,
    val userId: String,
    val deviceId: String,
    val username: String?,
    val expiresAt: String?
)

class SessionStore(context: Context) {
    private val prefs = SecurePreferencesFactory.create(context, "vostok_session")

    fun save(session: StoredSession) {
        prefs.edit()
            .putString("token", session.token)
            .putString("user_id", session.userId)
            .putString("device_id", session.deviceId)
            .putString("username", session.username)
            .putString("expires_at", session.expiresAt)
            .apply()
    }

    fun load(): StoredSession? {
        val token = prefs.getString("token", null) ?: return null
        val userId = prefs.getString("user_id", null) ?: return null
        val deviceId = prefs.getString("device_id", null) ?: return null
        return StoredSession(
            token = token,
            userId = userId,
            deviceId = deviceId,
            username = prefs.getString("username", null),
            expiresAt = prefs.getString("expires_at", null)
        )
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
