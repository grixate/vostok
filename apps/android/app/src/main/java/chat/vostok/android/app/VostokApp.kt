package chat.vostok.android.app

import android.app.Application
import android.util.Log

class VostokApp : Application() {
    lateinit var container: AppContainer
        private set

    lateinit var appState: AppState
        private set

    var initError: Throwable? = null
        private set

    override fun onCreate() {
        super.onCreate()
        try {
            container = AppContainer(this)
            container.loadServers()
            appState = AppState(container.authRepository.currentSession())
        } catch (e: Throwable) {
            Log.e("VostokApp", "Fatal initialization error", e)
            initError = e
        }
    }
}
