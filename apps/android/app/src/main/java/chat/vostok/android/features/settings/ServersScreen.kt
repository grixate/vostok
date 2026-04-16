package chat.vostok.android.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import chat.vostok.android.R
import chat.vostok.android.core.multiserver.ServerConnectionStatus
import chat.vostok.android.core.multiserver.ServerEntry
import chat.vostok.android.designsystem.components.VostokTopBar
import chat.vostok.android.designsystem.theme.*

@Composable
fun ServersScreen(
    servers: List<ServerEntry>,
    connectionStates: Map<String, ServerConnectionStatus>,
    onAddServer: (url: String, label: String, color: String) -> Unit,
    onRemoveServer: (String) -> Unit,
    onBack: () -> Unit,
) {
    var showAddDialog by remember { mutableStateOf(false) }

    Scaffold(topBar = { VostokTopBar(stringResource(R.string.servers)) }) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(VostokSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(VostokSpacing.sm),
        ) {
            items(servers, key = { it.id }) { server ->
                ServerRow(
                    server = server,
                    status = connectionStates[server.id] ?: ServerConnectionStatus.DISCONNECTED,
                    onRemove = { onRemoveServer(server.id) },
                )
            }

            item {
                TextButton(onClick = { showAddDialog = true }) {
                    Text("+ ${stringResource(R.string.add_server)}")
                }
            }
        }
    }

    if (showAddDialog) {
        AddServerDialog(
            onDismiss = { showAddDialog = false },
            onConfirm = { url, label ->
                onAddServer(url, label, "#FF5500")
                showAddDialog = false
            },
        )
    }
}

@Composable
private fun ServerRow(
    server: ServerEntry,
    status: ServerConnectionStatus,
    onRemove: () -> Unit,
) {
    val ext = VostokColors.current
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier.padding(VostokSpacing.lg),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(VostokSpacing.md),
        ) {
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .clip(CircleShape)
                    .background(parseHexColor(server.color))
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(server.label, style = VostokType.title)
                Text(server.url, style = VostokType.caption, color = ext.labelSecondary, maxLines = 1)
            }
            StatusBadge(status)
        }
    }
}

@Composable
private fun StatusBadge(status: ServerConnectionStatus) {
    val ext = VostokColors.current
    val (color, label) = when (status) {
        ServerConnectionStatus.CONNECTED -> ext.online to stringResource(R.string.connected)
        ServerConnectionStatus.CONNECTING -> ext.accentAmber to stringResource(R.string.connecting)
        ServerConnectionStatus.AUTH_REQUIRED -> ext.danger to stringResource(R.string.sign_in_required)
        ServerConnectionStatus.ERROR -> ext.danger to stringResource(R.string.connection_error)
        ServerConnectionStatus.OFFLINE -> ext.labelTertiary to stringResource(R.string.offline)
        ServerConnectionStatus.DISCONNECTED -> ext.labelTertiary to stringResource(R.string.disconnected)
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(color))
        Text(label, style = VostokType.small, color = ext.labelSecondary)
    }
}

@Composable
private fun AddServerDialog(onDismiss: () -> Unit, onConfirm: (url: String, label: String) -> Unit) {
    var url by remember { mutableStateOf("") }
    var label by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.add_server)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(VostokSpacing.sm)) {
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text(stringResource(R.string.server_url)) },
                    placeholder = { Text(stringResource(R.string.server_url_placeholder)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = { Text(stringResource(R.string.app_name)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(url, label.ifBlank { url }) },
                enabled = url.isNotBlank(),
            ) { Text(stringResource(R.string.add)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        },
    )
}

private fun parseHexColor(hex: String): Color {
    val cleaned = hex.removePrefix("#")
    return try { Color(("FF$cleaned").toLong(16)) } catch (_: Exception) { Color(0xFFFF5500) }
}
