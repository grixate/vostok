package chat.vostok.android.features.calls

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar

@Composable
fun CallScreen(viewModel: CallViewModel, initialChatId: String?, onOpenGroupCall: () -> Unit, onBack: () -> Unit) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(initialChatId, state.chatId) {
        if (!initialChatId.isNullOrBlank() && state.chatId.isBlank()) {
            viewModel.updateChatId(initialChatId)
        }
    }

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Call") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            OutlinedTextField(
                value = state.chatId,
                onValueChange = viewModel::updateChatId,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Chat ID") }
            )
            OutlinedTextField(
                value = state.callId,
                onValueChange = viewModel::updateCallId,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Call ID") }
            )
            Text("Mode: ${state.mode}")
            VostokButton(text = "Voice mode") { viewModel.updateMode("voice") }
            VostokButton(text = "Video mode") { viewModel.updateMode("video") }
            VostokButton(text = "Group mode") { viewModel.updateMode("group") }

            VostokButton(text = if (state.isLoading) "Working..." else "Start/Attach") {
                viewModel.startOrAttach()
            }
            VostokButton(text = "Refresh", onClick = viewModel::refresh)
            VostokButton(text = "Join (audio)") { viewModel.join("audio") }
            VostokButton(text = "Join (audio_video)") { viewModel.join("audio_video") }
            VostokButton(text = "Signal heartbeat", onClick = viewModel::sendHeartbeat)
            VostokButton(text = "Leave", onClick = viewModel::leave)
            VostokButton(text = "End", onClick = viewModel::end)
            VostokButton(text = "Group Call Controls", onClick = onOpenGroupCall)
            VostokButton(text = "Back", onClick = onBack)

            state.state?.let { callState ->
                Text("Call: ${callState.call.id}")
                Text("Mode: ${callState.call.mode}, Status: ${callState.call.status}")
                Text("Participants: ${callState.participantCount}, Signals: ${callState.signalCount}")
            }

            state.info?.let { Text(it) }
            state.error?.let { Text(it) }

            LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(state.signals) { signal ->
                    Text("${signal.signalType} from ${signal.fromDeviceId}")
                }
            }
        }
    }
}
