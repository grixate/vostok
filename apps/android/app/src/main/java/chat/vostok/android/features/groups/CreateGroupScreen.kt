package chat.vostok.android.features.groups

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar

@Composable
fun CreateGroupScreen(viewModel: GroupViewModel, onOpenGroupInfo: (String) -> Unit, onBack: () -> Unit) {
    val state by viewModel.uiState.collectAsState()

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Create Group") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedTextField(
                value = state.title,
                onValueChange = viewModel::updateTitle,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Group title") }
            )
            OutlinedTextField(
                value = state.membersInput,
                onValueChange = viewModel::updateMembersInput,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Members (comma-separated usernames)") }
            )
            VostokButton(
                text = if (state.isLoading) "Creating..." else "Create",
                onClick = viewModel::createGroup
            )
            VostokButton(text = "Back", onClick = onBack)

            state.chatId?.let { createdChatId ->
                VostokButton(text = "Open Group") { onOpenGroupInfo(createdChatId) }
            }

            state.info?.let { Text(it) }
            state.error?.let { Text(it) }
        }
    }
}
