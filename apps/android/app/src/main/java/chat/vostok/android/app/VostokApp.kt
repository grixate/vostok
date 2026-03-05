package chat.vostok.android.app

import android.app.Application

class VostokApp : Application() {
    lateinit var container: AppContainer
        private set

    lateinit var appState: AppState
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        appState = AppState(container.authRepository.currentSession())
    }
}
