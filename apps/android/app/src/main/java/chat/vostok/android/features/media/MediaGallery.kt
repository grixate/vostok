package chat.vostok.android.features.media

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
fun MediaGallery(
    chatId: String,
    viewModel: MediaViewModel,
    onOpenViewer: (String) -> Unit,
    onBack: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Media") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            OutlinedTextField(
                value = state.filename,
                onValueChange = viewModel::updateFilename,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Filename") }
            )
            OutlinedTextField(
                value = state.payloadText,
                onValueChange = viewModel::updatePayloadText,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Enter file content") }
            )
            VostokButton(
                text = if (state.isLoading) "Uploading..." else "Upload Text File",
                onClick = viewModel::uploadTextAsFile
            )

            MediaPickerSheet(
                linkUrl = state.linkUrl,
                onLinkUrlChange = viewModel::updateLinkUrl,
                onFetchLinkMetadata = viewModel::fetchLinkMetadata,
                isLoading = state.isLoading
            )

            state.latestUpload?.let { upload ->
                Text("Upload ID: ${upload.id}")
                Text("Status: ${upload.status}")
                Text("Uploaded parts: ${upload.uploadedPartCount}")
                VostokButton(text = "Refresh Upload", onClick = viewModel::refreshUpload)
                VostokButton(text = "Open Viewer") { onOpenViewer(upload.id) }
                VostokButton(text = "Send To Chat") { viewModel.sendLatestUploadToChat(chatId) }
            }

            state.metadata?.let { metadata ->
                Text("Title: ${metadata.title ?: metadata.hostname.orEmpty()}")
                metadata.description?.let { Text(it) }
            }

            state.cachedPath?.let { Text("Cached: $it") }
            state.info?.let { Text(it) }
            state.error?.let { Text(it) }

            VostokButton(text = "Back", onClick = onBack)
        }
    }
}
