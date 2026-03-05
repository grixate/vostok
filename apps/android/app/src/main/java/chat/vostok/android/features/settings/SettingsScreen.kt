package chat.vostok.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
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
    onOpenDevices: () -> Unit,
    onOpenPrivacy: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenSafetyNumbers: () -> Unit,
    onLogout: () -> Unit
) {
    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Settings") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(text = "Instance: ${BuildConfig.VOSTOK_INSTANCE_LABEL}")
            Text(text = "Base URL: ${BuildConfig.VOSTOK_BASE_URL}")
            Text(text = "User: ${username ?: "-"}")
            Text(text = "User ID: ${userId ?: "-"}")
            Text(text = "Device: ${deviceId ?: "-"}")

            VostokButton(text = "Devices", onClick = onOpenDevices)
            VostokButton(text = "Privacy", onClick = onOpenPrivacy)
            VostokButton(text = "Profile", onClick = onOpenProfile)
            VostokButton(text = "Safety Numbers", onClick = onOpenSafetyNumbers)
            VostokButton(text = "Logout", onClick = onLogout)
        }
    }
}
