package chat.vostok.android.features.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import chat.vostok.android.BuildConfig
import chat.vostok.android.R
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar
import chat.vostok.android.designsystem.theme.*

@Composable
fun AboutDebugScreen(
    connectionState: String,
    networkAvailable: Boolean,
    reconnectAttempts: Int,
    socketLogLines: List<String>,
    onForceReconnect: () -> Unit,
    onCopySocketLog: () -> Unit,
    onClearSocketLog: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val ext = VostokColors.current
    var debugCopied by remember { mutableStateOf(false) }

    Scaffold(topBar = { VostokTopBar(stringResource(R.string.about_and_debug)) }) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(VostokSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(VostokSpacing.sm),
        ) {
            // App info
            item {
                Text(stringResource(R.string.vostok), style = VostokType.headline)
                Spacer(Modifier.height(VostokSpacing.sm))
            }
            item { InfoRow(stringResource(R.string.client_version), BuildConfig.VERSION_NAME) }
            item { InfoRow(stringResource(R.string.platform), "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})") }
            item { InfoRow(stringResource(R.string.device), "${Build.MANUFACTURER} ${Build.MODEL}") }
            item { InfoRow(stringResource(R.string.encryption), stringResource(R.string.e2ee_protocol)) }

            // Connection status
            item {
                Spacer(Modifier.height(VostokSpacing.lg))
                Text(stringResource(R.string.status), style = VostokType.headline)
                Spacer(Modifier.height(VostokSpacing.sm))
            }
            item {
                InfoRow("State", connectionState,
                    valueColor = if (connectionState == "connected") ext.online else ext.labelSecondary)
            }
            item {
                InfoRow("Network", if (networkAvailable) "Available" else stringResource(R.string.offline),
                    valueColor = if (networkAvailable) ext.online else ext.danger)
            }
            item { InfoRow("Reconnects", "$reconnectAttempts") }

            // Actions
            item {
                Spacer(Modifier.height(VostokSpacing.md))
                Row(horizontalArrangement = Arrangement.spacedBy(VostokSpacing.sm)) {
                    VostokButton(
                        text = if (debugCopied) stringResource(R.string.copied) else stringResource(R.string.copy_debug_info),
                        onClick = {
                            copyDebugInfo(context, connectionState, networkAvailable, reconnectAttempts)
                            debugCopied = true
                        },
                    )
                }
            }

            item {
                Spacer(Modifier.height(VostokSpacing.sm))
                VostokButton(text = stringResource(R.string.force_reconnect), onClick = onForceReconnect)
            }

            // Socket log
            item {
                Spacer(Modifier.height(VostokSpacing.lg))
                Text(stringResource(R.string.socket_log_latest), style = VostokType.headline)
                Spacer(Modifier.height(VostokSpacing.sm))
            }

            if (socketLogLines.isEmpty()) {
                item {
                    Text("No socket events yet", style = VostokType.caption, color = ext.labelSecondary)
                }
            } else {
                items(socketLogLines.reversed()) { line ->
                    Text(line, style = VostokType.micro.copy(fontFamily = FontFamily.Monospace), color = ext.labelSecondary)
                }
            }

            item {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(VostokSpacing.sm),
                    modifier = Modifier.padding(vertical = VostokSpacing.sm),
                ) {
                    VostokButton(text = stringResource(R.string.copy_socket_log), onClick = onCopySocketLog)
                    VostokButton(text = stringResource(R.string.clear_socket_log), onClick = onClearSocketLog)
                }
            }
        }
    }
}

@Composable
private fun InfoRow(
    label: String,
    value: String,
    valueColor: androidx.compose.ui.graphics.Color = VostokColors.current.labelSecondary,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = VostokType.body)
        Text(value, style = VostokType.body, color = valueColor)
    }
}

private fun copyDebugInfo(
    context: Context,
    connectionState: String,
    networkAvailable: Boolean,
    reconnectAttempts: Int,
) {
    val info = """
        Vostok Android v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})
        Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})
        Device: ${Build.MANUFACTURER} ${Build.MODEL}
        Connection: $connectionState
        Network: ${if (networkAvailable) "available" else "offline"}
        Reconnects: $reconnectAttempts
    """.trimIndent()
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Vostok Debug Info", info))
}
