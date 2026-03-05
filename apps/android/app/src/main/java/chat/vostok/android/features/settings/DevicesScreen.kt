package chat.vostok.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar

@Composable
fun DevicesScreen(viewModel: SettingsViewModel, onBackToSettings: () -> Unit) {
    val state by viewModel.uiState.collectAsState()

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Devices") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            VostokButton(
                text = if (state.isLoadingDevices) "Refreshing..." else "Refresh Devices",
                onClick = viewModel::refreshDevices
            )
            VostokButton(text = "Back", onClick = onBackToSettings)

            state.error?.let { Text(it) }
            state.info?.let { Text(it) }

            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(state.devices) { device ->
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(text = device.deviceName)
                        Text(text = "Device: ${device.id}")
                        Text(text = if (device.isCurrent) "Current device" else "Linked device")
                        Text(text = "Prekeys: ${device.oneTimePrekeyCount}")
                        if (!device.isCurrent && device.revokedAt == null) {
                            VostokButton(text = "Revoke") {
                                viewModel.revokeDevice(device.id)
                            }
                        }
                    }
                }
            }
        }
    }
}
