package chat.vostok.android.core.crypto

class SessionManager {
    fun ensureSession(peerDeviceId: String): String {
        return "session:$peerDeviceId"
    }
}
