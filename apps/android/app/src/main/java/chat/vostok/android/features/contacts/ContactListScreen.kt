package chat.vostok.android.features.contacts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokListItem
import chat.vostok.android.designsystem.components.VostokTopBar
import kotlinx.coroutines.launch

@Composable
fun ContactListScreen(
    paddingValues: PaddingValues,
    viewModel: ContactListViewModel,
    onOpenConversation: (String) -> Unit,
    onOpenCreateGroup: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    val scope = rememberCoroutineScope()
    val filtered = state.items.filter {
        state.search.isBlank() || it.username.contains(state.search, ignoreCase = true)
    }

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Contacts") }) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 12.dp),
            contentPadding = PaddingValues(
                top = innerPadding.calculateTopPadding() + paddingValues.calculateTopPadding(),
                bottom = innerPadding.calculateBottomPadding() + paddingValues.calculateBottomPadding()
            ),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item {
                OutlinedTextField(
                    value = state.search,
                    onValueChange = viewModel::updateSearch,
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Search username") }
                )
            }

            item {
                VostokButton(
                    text = if (state.isLoading) "Syncing..." else "Refresh",
                    onClick = viewModel::refresh
                )
            }

            item {
                VostokButton(text = "Create Group", onClick = onOpenCreateGroup)
            }

            state.error?.let { error ->
                item {
                    Text(
                        text = error,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
                    )
                }
            }

            items(filtered) { item ->
                VostokListItem(
                    title = item.username,
                    subtitle = item.subtitle,
                    onClick = {
                        scope.launch {
                            runCatching {
                                viewModel.openOrCreateDirect(item.username)
                            }.onSuccess(onOpenConversation)
                        }
                    }
                )
            }
        }
    }
}
