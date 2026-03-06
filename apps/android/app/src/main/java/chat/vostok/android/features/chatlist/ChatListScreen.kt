package chat.vostok.android.features.chatlist

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokListItem
import chat.vostok.android.designsystem.components.VostokTopBar
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun ChatListScreen(
    paddingValues: PaddingValues,
    viewModel: ChatListViewModel,
    onOpenConversation: (String, String?) -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Chats") }) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 12.dp),
            contentPadding = PaddingValues(
                top = innerPadding.calculateTopPadding() + paddingValues.calculateTopPadding(),
                bottom = innerPadding.calculateBottomPadding() + paddingValues.calculateBottomPadding()
            )
        ) {
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp, bottom = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    AssistChip(
                        onClick = { },
                        enabled = false,
                        label = {
                            androidx.compose.material3.Text(
                                text = state.connectionState.name.lowercase().replaceFirstChar(Char::titlecase),
                                style = MaterialTheme.typography.labelMedium
                            )
                        },
                        colors = AssistChipDefaults.assistChipColors(
                            disabledContainerColor = socketChipColor(state.connectionState),
                            disabledLabelColor = Color.White
                        )
                    )
                    Spacer(modifier = Modifier.weight(1f))
                    if (state.reconnectAttempt > 0) {
                        androidx.compose.material3.Text(
                            text = "Reconnections: ${state.reconnectAttempt}",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 8.dp)
                        )
                    }
                }
            }

            item {
                VostokButton(
                    text = if (state.isLoading) "Syncing..." else "Refresh",
                    onClick = viewModel::refresh
                )
            }

            state.error?.let { message ->
                item {
                    androidx.compose.material3.Text(
                        text = message,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
                    )
                }
            }

            items(state.items) { item ->
                VostokListItem(
                    title = item.title,
                    subtitle = item.subtitle,
                    trailingText = item.updatedAt?.let(::formatChatTime),
                    onClick = { onOpenConversation(item.id, item.title) }
                )
            }
        }
    }
}

@Composable
private fun socketChipColor(state: chat.vostok.android.core.network.SocketConnectionState): Color {
    return when (state) {
        chat.vostok.android.core.network.SocketConnectionState.CONNECTED -> Color(0xFF2F9E44)
        chat.vostok.android.core.network.SocketConnectionState.CONNECTING -> Color(0xFF3B82F6)
        chat.vostok.android.core.network.SocketConnectionState.RECONNECTING -> Color(0xFFF59F00)
        chat.vostok.android.core.network.SocketConnectionState.PAUSED -> Color(0xFF6C757D)
        chat.vostok.android.core.network.SocketConnectionState.DISCONNECTED -> Color(0xFFDB4437)
    }
}

private fun formatChatTime(raw: String): String {
    val instant = runCatching { Instant.parse(raw) }.getOrNull() ?: return ""
    val local = instant.atZone(ZoneId.systemDefault())
    val now = Instant.now().atZone(ZoneId.systemDefault())
    return if (local.toLocalDate() == now.toLocalDate()) {
        local.format(DateTimeFormatter.ofPattern("HH:mm"))
    } else {
        local.format(DateTimeFormatter.ofPattern("dd MMM"))
    }
}
