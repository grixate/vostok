package chat.vostok.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar

@Composable
fun PrivacySettingsScreen(viewModel: SettingsViewModel, onBackToSettings: () -> Unit) {
    val state by viewModel.uiState.collectAsState()

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Privacy") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Read receipts")
                Switch(
                    checked = state.readReceipts,
                    onCheckedChange = viewModel::setReadReceipts
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Biometric lock")
                Switch(
                    checked = state.biometricLock,
                    onCheckedChange = viewModel::setBiometricLock
                )
            }

            VostokButton(text = "Back", onClick = onBackToSettings)
        }
    }
}
