package chat.vostok.android.app

import android.content.Intent
import android.os.Bundle
import android.os.Process
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.core.push.PushConstants
import chat.vostok.android.designsystem.theme.VostokTheme
import chat.vostok.android.navigation.VostokNavGraph

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as VostokApp

        val error = app.initError
        if (error != null) {
            setContent {
                VostokTheme {
                    Surface(modifier = Modifier.fillMaxSize()) {
                        Column(
                            modifier = Modifier.fillMaxSize().padding(24.dp),
                            verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(
                                text = "Vostok failed to start",
                                style = MaterialTheme.typography.headlineSmall
                            )
                            Spacer(modifier = Modifier.height(12.dp))
                            Text(
                                text = error.message ?: error.toString(),
                                style = MaterialTheme.typography.bodyMedium
                            )
                            Spacer(modifier = Modifier.height(24.dp))
                            Button(onClick = {
                                clearAppDataAndRestart()
                            }) {
                                Text("Clear data and restart")
                            }
                        }
                    }
                }
            }
            return
        }

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

    private fun clearAppDataAndRestart() {
        cacheDir.deleteRecursively()
        filesDir.deleteRecursively()
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            startActivity(intent)
        }
        Process.killProcess(Process.myPid())
    }
}
