package chat.vostok.android.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import chat.vostok.android.designsystem.theme.VostokTheme
import chat.vostok.android.navigation.VostokNavGraph

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as VostokApp
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
}
