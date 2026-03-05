package chat.vostok.android.app

class SessionTokenProvider {
    @Volatile
    private var token: String? = null

    fun set(value: String?) {
        token = value
    }

    fun get(): String? = token
}
