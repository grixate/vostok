package chat.vostok.android.features.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar

@Composable
fun ProfileScreen(
    username: String?,
    userId: String?,
    deviceId: String?,
    onBack: () -> Unit
) {
    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Profile") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text("Username: ${username ?: "-"}")
            Text("User ID: ${userId ?: "-"}")
            Text("Device ID: ${deviceId ?: "-"}")
            VostokButton(text = "Back", onClick = onBack)
        }
    }
}
