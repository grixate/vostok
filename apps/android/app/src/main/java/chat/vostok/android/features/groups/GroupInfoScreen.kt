package chat.vostok.android.features.groups

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import chat.vostok.android.R
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar

@Composable
fun GroupInfoScreen(chatId: String, viewModel: GroupViewModel, onBack: () -> Unit) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(chatId) {
        viewModel.loadGroup(chatId)
    }

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar(stringResource(R.string.view_group_info)) }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            VostokButton(text = if (state.isLoading) stringResource(R.string.refreshing) else stringResource(R.string.refresh)) {
                viewModel.loadGroup(chatId)
            }
            VostokButton(text = stringResource(R.string.back), onClick = onBack)

            state.info?.let { Text(it) }
            state.error?.let { Text(it) }

            Text(stringResource(R.string.members))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                items(state.members) { member ->
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text("${member.username} (${member.role})")
                        VostokButton(text = stringResource(R.string.toggle_role)) { viewModel.toggleRole(chatId, member) }
                        VostokButton(text = stringResource(R.string.remove)) { viewModel.removeMember(chatId, member) }
                    }
                }
            }

            Text(stringResource(R.string.safety_numbers))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                items(state.safetyNumbers) { safety ->
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text("${safety.peerUsername} · ${if (safety.verified) stringResource(R.string.verified) else stringResource(R.string.unverified)}")
                        Text("${safety.peerDeviceName}: ${safety.fingerprint.take(20)}...")
                        if (!safety.verified) {
                            VostokButton(text = stringResource(R.string.verify)) {
                                viewModel.verifySafety(chatId, safety.peerDeviceId)
                            }
                        }
                    }
                }
            }
        }
    }
}
