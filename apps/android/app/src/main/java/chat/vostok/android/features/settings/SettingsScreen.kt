package chat.vostok.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import chat.vostok.android.BuildConfig
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar

@Composable
fun SettingsScreen(
    paddingValues: PaddingValues,
    username: String?,
    userId: String?,
    deviceId: String?,
    secureStorageSummary: String,
    socketSummary: String,
    socketEvents: List<String>,
    onForceReconnect: () -> Unit,
    onClearSocketLog: () -> Unit,
    onOpenDevices: () -> Unit,
    onOpenPrivacy: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenSafetyNumbers: () -> Unit,
    onLogout: () -> Unit
) {
    val clipboard = LocalClipboardManager.current
    val scrollState = rememberScrollState()

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Settings") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(paddingValues)
                .verticalScroll(scrollState)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(text = "Instance: ${BuildConfig.VOSTOK_INSTANCE_LABEL}")
            Text(text = "Base URL: ${BuildConfig.VOSTOK_BASE_URL}")
            Text(text = "User: ${username ?: "-"}")
            Text(text = "User ID: ${userId ?: "-"}")
            Text(text = "Device: ${deviceId ?: "-"}")
            Text(text = "Crypto storage: $secureStorageSummary")
            Text(text = "Realtime: $socketSummary")

            if (socketEvents.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFFF6F8FB), RoundedCornerShape(12.dp))
                        .padding(10.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(text = "Socket log (latest)")
                    socketEvents.takeLast(6).reversed().forEach { line ->
                        Text(text = line)
                    }
                }
            }

            VostokButton(text = "Force Reconnect", onClick = onForceReconnect)
            VostokButton(
                text = "Copy Socket Log",
                onClick = {
                    val content = if (socketEvents.isEmpty()) {
                        "No socket events yet."
                    } else {
                        socketEvents.joinToString(separator = "\n")
                    }
                    clipboard.setText(AnnotatedString(content))
                }
            )
            VostokButton(text = "Clear Socket Log", onClick = onClearSocketLog)

            VostokButton(text = "Devices", onClick = onOpenDevices)
            VostokButton(text = "Privacy", onClick = onOpenPrivacy)
            VostokButton(text = "Profile", onClick = onOpenProfile)
            VostokButton(text = "Safety Numbers", onClick = onOpenSafetyNumbers)
            VostokButton(text = "Logout", onClick = onLogout)
        }
    }
}
