package chat.vostok.android.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import chat.vostok.android.core.push.PushConstants
import chat.vostok.android.designsystem.theme.VostokTheme
import chat.vostok.android.navigation.VostokNavGraph

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as VostokApp
        handleIntent(app, intent)
        setContent {
            VostokTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    VostokNavGraph(
                        appState = app.appState,
                        container = app.container
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val app = application as VostokApp
        handleIntent(app, intent)
    }

    private fun handleIntent(app: VostokApp, intent: Intent?) {
        val chatId = intent?.getStringExtra(PushConstants.EXTRA_CHAT_ID)
        app.appState.requestOpenChat(chatId)
    }
}
