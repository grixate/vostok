package chat.vostok.android.features.media

import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.widget.VideoView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import coil.compose.AsyncImage
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar
import java.io.File

@Composable
fun ImageViewer(
    uploadId: String,
    viewModel: MediaViewModel,
    onBack: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    val upload = state.latestUpload
    val cachedPath = state.cachedPath

    LaunchedEffect(uploadId) {
        if (upload?.id != uploadId) viewModel.loadUpload(uploadId)
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
            upload?.let { current ->
                Text("Filename: ${current.filename}")
                Text("Type: ${current.contentType}")
                Text("Status: ${current.status}")
                Text("SHA256: ${current.ciphertextSha256 ?: "-"}")
                Text("Parts: ${current.uploadedPartCount}/${current.expectedPartCount ?: "?"}")
            }
            cachedPath?.let { path ->
                Text("Cached file: $path")
                upload?.let { current ->
                    UploadPreview(contentType = current.contentType, cachedPath = path)
                }
            }
            state.error?.let { Text(it) }
            VostokButton(text = "Back", onClick = onBack)
        }
    }
}

@Composable
private fun UploadPreview(
    contentType: String,
    cachedPath: String
) {
    val file = remember(cachedPath) { File(cachedPath) }
    if (!file.exists()) {
        Text("Cached file is unavailable.")
        return
    }

    when {
        contentType.startsWith("image/") -> {
            AsyncImage(
                model = file,
                contentDescription = "Uploaded image preview",
                modifier = Modifier
                    .fillMaxWidth()
                    .height(280.dp)
                    .background(MaterialTheme.colorScheme.surfaceVariant)
            )
        }

        contentType.startsWith("video/") -> {
            var videoView by remember { mutableStateOf<VideoView?>(null) }
            Text("Video preview")
            AndroidView(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(260.dp)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                factory = { context ->
                    VideoView(context).apply {
                        videoView = this
                        setVideoPath(file.absolutePath)
                        seekTo(150)
                    }
                },
                update = { view ->
                    videoView = view
                    view.setVideoPath(file.absolutePath)
                }
            )
            androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                VostokButton(text = "Play") { videoView?.start() }
                VostokButton(text = "Pause") { videoView?.pause() }
            }
        }

        contentType.startsWith("audio/") -> {
            var player by remember { mutableStateOf<MediaPlayer?>(null) }
            val duration = remember(file.absolutePath) { readDurationSeconds(file.absolutePath) }

            DisposableEffect(file.absolutePath) {
                onDispose {
                    runCatching { player?.release() }
                }
            }

            Text("Audio preview (${duration}s)")
            androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                VostokButton(text = "Play") {
                    runCatching {
                        player?.release()
                        player = MediaPlayer().apply {
                            setDataSource(file.absolutePath)
                            prepare()
                            start()
                        }
                    }
                }
                VostokButton(text = "Stop") {
                    runCatching {
                        player?.stop()
                        player?.release()
                        player = null
                    }
                }
            }
        }

        contentType.startsWith("text/") -> {
            val preview = remember(file.absolutePath) {
                runCatching { file.readText().take(1200) }.getOrDefault("Unable to read text file.")
            }
            Text("Text preview")
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(220.dp)
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(10.dp)
            ) {
                Text(preview, style = MaterialTheme.typography.bodySmall)
            }
        }

        else -> {
            Text("No inline preview for $contentType.")
        }
    }
}

private fun readDurationSeconds(path: String): Int {
    val retriever = MediaMetadataRetriever()
    return runCatching {
        retriever.setDataSource(path)
        val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
            ?.toLongOrNull()
            ?: 0L
        (durationMs / 1_000L).toInt()
    }.getOrDefault(0).coerceAtLeast(1).also {
        runCatching { retriever.release() }
    }
}
