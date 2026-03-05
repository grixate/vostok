package chat.vostok.android.features.calls

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar

@Composable
fun GroupCallScreen(viewModel: CallViewModel, onBack: () -> Unit) {
    val state by viewModel.uiState.collectAsState()

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Group Call") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text("Use this screen to join group calls with E2EE-ready signal flow.")
            VostokButton(text = "Join audio_video") { viewModel.join("audio_video") }
            VostokButton(text = "Rotate heartbeat signal") { viewModel.sendHeartbeat() }
            VostokButton(text = "Refresh", onClick = viewModel::refresh)
            VostokButton(text = "Back", onClick = onBack)

            state.state?.let {
                Text("Call: ${it.call.id} (${it.call.status})")
                Text("Participants: ${it.participantCount}")
            }
        }
    }
}
