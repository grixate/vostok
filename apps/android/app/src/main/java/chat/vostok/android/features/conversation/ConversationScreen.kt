package chat.vostok.android.features.conversation

import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.net.Uri
import android.widget.VideoView
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import chat.vostok.android.R
import androidx.compose.ui.viewinterop.AndroidView
import chat.vostok.android.designsystem.components.VostokTopBar
import chat.vostok.android.designsystem.components.VostokButton
import java.io.File

@Composable
fun ConversationScreen(
    chatId: String,
    chatTitle: String?,
    recipientDeviceIds: List<String>,
    viewModel: ConversationViewModel,
    onOpenCall: ((String) -> Unit)? = null,
    onOpenGroupInfo: ((String) -> Unit)? = null,
    onOpenMedia: ((String) -> Unit)? = null
) {
    val context = LocalContext.current
    val state by viewModel.uiState.collectAsState()
    val voiceRecorder = remember(context) { VoiceRecorder(context) }
    var isVoiceRecording by remember { mutableStateOf(false) }
    var voiceFile by remember { mutableStateOf<File?>(null) }
    var voiceDurationSeconds by remember { mutableStateOf(0) }
    var voicePlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var roundPreviewFile by remember { mutableStateOf<File?>(null) }
    var roundDurationSeconds by remember { mutableStateOf(0) }
    var roundVideoView by remember { mutableStateOf<VideoView?>(null) }
    var showRoundCapture by remember { mutableStateOf(false) }

    LaunchedEffect(chatId) {
        viewModel.load(chatId)
    }

    DisposableEffect(Unit) {
        onDispose {
            runCatching { voiceRecorder.stop() }
            runCatching { voicePlayer?.release() }
            runCatching { roundVideoView?.stopPlayback() }
        }
    }

    androidx.compose.material3.Scaffold(topBar = { VostokTopBar(chatTitle?.takeIf { it.isNotBlank() } ?: stringResource(R.string.conversation)) }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                VostokButton(text = stringResource(R.string.call)) { onOpenCall?.invoke(chatId) }
                VostokButton(text = stringResource(R.string.group)) { onOpenGroupInfo?.invoke(chatId) }
                VostokButton(text = stringResource(R.string.media)) { onOpenMedia?.invoke(chatId) }
                VostokButton(
                    text = if (isVoiceRecording) stringResource(R.string.stop_voice) else stringResource(R.string.record_voice)
                ) {
                    if (isVoiceRecording) {
                        voiceFile = voiceRecorder.stop()
                        voiceDurationSeconds = voiceFile
                            ?.absolutePath
                            ?.let(::readDurationSecondsFromPath)
                            ?: 0
                        isVoiceRecording = false
                    } else {
                        voiceFile = voiceRecorder.start()
                        voiceDurationSeconds = 0
                        isVoiceRecording = true
                    }
                }
                VostokButton(text = stringResource(R.string.capture_round)) {
                    showRoundCapture = true
                }
                if (state.editingMessageId != null) {
                    TextButton(onClick = viewModel::cancelEdit) {
                        Text(stringResource(R.string.cancel_edit))
                    }
                }
            }

            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(state.messages) { message ->
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        MessageBubble(
                            text = viewModel.previewText(message),
                            isOutgoing = message.senderDeviceId == "local" || message.senderDeviceId == "cached",
                            footer = message.insertedAt
                        )
                        Row(
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            TextButton(onClick = { viewModel.startEdit(message) }) { Text(stringResource(R.string.edit)) }
                            TextButton(onClick = { viewModel.togglePin(chatId, message.id) }) { Text(stringResource(R.string.pin)) }
                            TextButton(onClick = { viewModel.toggleReaction(chatId, message.id) }) { Text("👍") }
                            TextButton(onClick = { viewModel.delete(chatId, message.id) }) { Text(stringResource(R.string.delete)) }
                        }
                    }
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                voiceFile?.let { file ->
                    VostokButton(text = stringResource(R.string.play_voice)) {
                        runCatching {
                            voicePlayer?.release()
                            voicePlayer = MediaPlayer().apply {
                                setDataSource(file.absolutePath)
                                prepare()
                                setOnCompletionListener {
                                    it.release()
                                    voicePlayer = null
                                }
                                start()
                            }
                        }
                    }
                    VostokButton(text = stringResource(R.string.send_voice)) {
                        val payload = runCatching { file.readBytes() }.getOrNull()
                        if (payload != null) {
                            viewModel.sendVoiceUpload(
                                chatId = chatId,
                                filename = file.name,
                                contentType = "audio/mp4",
                                payload = payload,
                                durationSeconds = voiceDurationSeconds.coerceAtLeast(1),
                                recipientDeviceIds = recipientDeviceIds
                            )
                        } else {
                            viewModel.sendVoice(
                                chatId = chatId,
                                recipientDeviceIds = recipientDeviceIds,
                                durationSeconds = voiceDurationSeconds.coerceAtLeast(1)
                            )
                        }
                    }
                    Text(stringResource(R.string.voice_duration, voiceDurationSeconds.coerceAtLeast(1)))
                }
            }

            if (showRoundCapture) {
                RoundVideoCapturePanel(
                    onCaptured = { file, durationSeconds ->
                        roundPreviewFile = file
                        roundDurationSeconds = durationSeconds
                        showRoundCapture = false
                    },
                    onCancel = {
                        showRoundCapture = false
                    }
                )
            }

            roundPreviewFile?.let { file ->
                Text(stringResource(R.string.round_clip_duration, roundDurationSeconds.coerceAtLeast(1)))
                AndroidView(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    factory = { viewContext ->
                        VideoView(viewContext).apply {
                            roundVideoView = this
                            setVideoURI(Uri.fromFile(file))
                            seekTo(100)
                        }
                    },
                    update = { videoView ->
                        roundVideoView = videoView
                        videoView.setVideoURI(Uri.fromFile(file))
                        videoView.seekTo(100)
                    }
                )
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    VostokButton(text = stringResource(R.string.play_round)) {
                        roundVideoView?.start()
                    }
                    VostokButton(text = stringResource(R.string.send_round)) {
                        val payload = runCatching { file.readBytes() }.getOrNull()
                        if (payload != null) {
                            viewModel.sendRoundVideoUpload(
                                chatId = chatId,
                                filename = file.name,
                                contentType = "video/mp4",
                                payload = payload,
                                durationSeconds = roundDurationSeconds.coerceAtLeast(1),
                                recipientDeviceIds = recipientDeviceIds
                            )
                        } else {
                            viewModel.sendRoundVideo(
                                chatId = chatId,
                                recipientDeviceIds = recipientDeviceIds,
                                durationSeconds = roundDurationSeconds.coerceAtLeast(1)
                            )
                        }
                    }
                }
            }

            MessageComposer(
                value = state.composer,
                onValueChange = viewModel::updateComposer,
                onSend = {
                    viewModel.send(chatId, recipientDeviceIds)
                },
                sendLabel = if (state.editingMessageId == null) stringResource(R.string.send) else stringResource(R.string.save)
            )

            state.error?.let { Text(it) }
        }
    }
}

private fun readDurationSecondsFromPath(path: String): Int {
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
