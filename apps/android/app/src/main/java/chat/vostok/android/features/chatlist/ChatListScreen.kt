package chat.vostok.android.features.chatlist

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokListItem
import chat.vostok.android.designsystem.components.VostokTopBar

@Composable
fun ChatListScreen(
    paddingValues: PaddingValues,
    viewModel: ChatListViewModel,
    onOpenConversation: (String) -> Unit
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
                    onClick = { onOpenConversation(item.id) }
                )
            }
        }
    }
}
