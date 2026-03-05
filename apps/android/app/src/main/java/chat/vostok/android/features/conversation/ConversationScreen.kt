package chat.vostok.android.features.conversation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokTopBar
import chat.vostok.android.designsystem.components.VostokButton

@Composable
fun ConversationScreen(
    chatId: String,
    recipientDeviceIds: List<String>,
    viewModel: ConversationViewModel,
    onOpenCall: ((String) -> Unit)? = null,
    onOpenGroupInfo: ((String) -> Unit)? = null,
    onOpenMedia: ((String) -> Unit)? = null
) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(chatId) {
        viewModel.load(chatId)
    }

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Conversation") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                VostokButton(text = "Call") { onOpenCall?.invoke(chatId) }
                VostokButton(text = "Group") { onOpenGroupInfo?.invoke(chatId) }
                VostokButton(text = "Media") { onOpenMedia?.invoke(chatId) }
                VostokButton(text = "Voice") { viewModel.sendVoice(chatId, recipientDeviceIds) }
                VostokButton(text = "Round") { viewModel.sendRoundVideo(chatId, recipientDeviceIds) }
                if (state.editingMessageId != null) {
                    TextButton(onClick = viewModel::cancelEdit) {
                        Text("Cancel edit")
                    }
                }
            }

            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(state.messages) { message ->
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        MessageBubble(
                            text = viewModel.previewText(message),
                            isOutgoing = message.senderDeviceId == "local" || message.senderDeviceId == "cached",
                            footer = message.insertedAt
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { viewModel.startEdit(message) }) { Text("Edit") }
                            TextButton(onClick = { viewModel.togglePin(chatId, message.id) }) { Text("Pin") }
                            TextButton(onClick = { viewModel.toggleReaction(chatId, message.id) }) { Text("👍") }
                            TextButton(onClick = { viewModel.delete(chatId, message.id) }) { Text("Delete") }
                        }
                    }
                }
            }

            MessageComposer(
                value = state.composer,
                onValueChange = viewModel::updateComposer,
                onSend = {
                    viewModel.send(chatId, recipientDeviceIds)
                },
                sendLabel = if (state.editingMessageId == null) "Send" else "Save"
            )

            state.error?.let { Text(it) }
        }
    }
}
