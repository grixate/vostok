package chat.vostok.android.features.channels

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import chat.vostok.android.R
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTextField
import chat.vostok.android.designsystem.components.VostokTopBar
import chat.vostok.android.designsystem.theme.VostokSpacing
import chat.vostok.android.designsystem.theme.VostokType

@Composable
fun CreateChannelScreen(
    onCreateChannel: (title: String, description: String?, allowComments: Boolean) -> Unit,
    isLoading: Boolean = false,
    error: String? = null,
    onBack: () -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var allowComments by remember { mutableStateOf(true) }

    Scaffold(topBar = { VostokTopBar(stringResource(R.string.create_channel)) }) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(VostokSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(VostokSpacing.md),
        ) {
            VostokTextField(
                value = title,
                onValueChange = { title = it },
                placeholder = stringResource(R.string.channel_title),
            )

            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                placeholder = { Text(stringResource(R.string.description)) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                maxLines = 5,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(stringResource(R.string.allow_comments), style = VostokType.body)
                Switch(checked = allowComments, onCheckedChange = { allowComments = it })
            }

            if (error != null) {
                Text(error, style = VostokType.caption, color = MaterialTheme.colorScheme.error)
            }

            Spacer(Modifier.weight(1f))

            VostokButton(
                text = if (isLoading) stringResource(R.string.creating) else stringResource(R.string.create_channel),
                onClick = {
                    val desc = description.trim().ifEmpty { null }
                    onCreateChannel(title.trim(), desc, allowComments)
                },
                enabled = title.isNotBlank() && !isLoading,
            )

            VostokButton(text = stringResource(R.string.back), onClick = onBack)
        }
    }
}
