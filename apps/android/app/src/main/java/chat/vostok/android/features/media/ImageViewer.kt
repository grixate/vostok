package chat.vostok.android.features.media

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar

@Composable
fun ImageViewer(
    uploadId: String,
    viewModel: MediaViewModel,
    onBack: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(uploadId) {
        if (state.latestUpload?.id != uploadId) viewModel.loadUpload(uploadId)
    }

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Upload Viewer") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text("Upload ID: $uploadId")
            state.latestUpload?.let { upload ->
                Text("Filename: ${upload.filename}")
                Text("Status: ${upload.status}")
                Text("SHA256: ${upload.ciphertextSha256 ?: "-"}")
                Text("Parts: ${upload.uploadedPartCount}/${upload.expectedPartCount ?: "?"}")
            }
            state.cachedPath?.let { Text("Cached file: $it") }
            state.error?.let { Text(it) }
            VostokButton(text = "Back", onClick = onBack)
        }
    }
}
