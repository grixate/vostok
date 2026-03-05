package chat.vostok.android.features.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar
import chat.vostok.android.features.groups.GroupViewModel

@Composable
fun SafetyNumberScreen(
    viewModel: GroupViewModel,
    onBack: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    var chatId by remember { mutableStateOf(state.chatId.orEmpty()) }

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Safety Numbers") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            OutlinedTextField(
                value = chatId,
                onValueChange = { chatId = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Chat ID") }
            )

            VostokButton(text = "Load Safety Numbers") {
                if (chatId.isNotBlank()) viewModel.loadGroup(chatId)
            }
            VostokButton(text = "Back", onClick = onBack)

            state.info?.let { Text(it) }
            state.error?.let { Text(it) }

            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(state.safetyNumbers) { safety ->
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("${safety.peerUsername} · ${safety.peerDeviceName}")
                        Text("${if (safety.verified) "verified" else "unverified"} · ${safety.fingerprint}")
                        if (!safety.verified && chatId.isNotBlank()) {
                            VostokButton(text = "Verify") {
                                viewModel.verifySafety(chatId, safety.peerDeviceId)
                            }
                        }
                    }
                }
            }
        }
    }
}
