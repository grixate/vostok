package chat.vostok.android.features.conversation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaMetadataRetriever
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import chat.vostok.android.designsystem.components.VostokButton
import kotlinx.coroutines.delay
import java.io.File

@Composable
fun RoundVideoCapturePanel(
    modifier: Modifier = Modifier,
    maxDurationSeconds: Int = 30,
    onCaptured: (File, Int) -> Unit,
    onCancel: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    val cameraProviderFuture = remember { ProcessCameraProvider.getInstance(context) }
    val previewView = remember {
        PreviewView(context).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
    }

    var hasCameraPermission by remember {
        mutableStateOf(context.hasPermission(Manifest.permission.CAMERA))
    }
    var hasAudioPermission by remember {
        mutableStateOf(context.hasPermission(Manifest.permission.RECORD_AUDIO))
    }
    var isRecording by remember { mutableStateOf(false) }
    var elapsedSeconds by remember { mutableStateOf(0) }
    var videoCapture by remember { mutableStateOf<VideoCapture<Recorder>?>(null) }
    var activeRecording by remember { mutableStateOf<Recording?>(null) }
    var lastError by remember { mutableStateOf<String?>(null) }
    var currentFile by remember { mutableStateOf<File?>(null) }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        hasCameraPermission = result[Manifest.permission.CAMERA] == true
        hasAudioPermission = result[Manifest.permission.RECORD_AUDIO] == true
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission || !hasAudioPermission) {
            permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.CAMERA,
                    Manifest.permission.RECORD_AUDIO
                )
            )
        }
    }

    LaunchedEffect(isRecording) {
        if (!isRecording) return@LaunchedEffect
        elapsedSeconds = 0
        while (isRecording) {
            delay(1_000)
            elapsedSeconds += 1
            if (elapsedSeconds >= maxDurationSeconds) {
                activeRecording?.stop()
            }
        }
    }

    DisposableEffect(lifecycleOwner, hasCameraPermission) {
        if (!hasCameraPermission) {
            onDispose {
                activeRecording?.stop()
                activeRecording = null
                isRecording = false
            }
        } else {
            val executor = ContextCompat.getMainExecutor(context)
            val listener = Runnable {
                val cameraProvider = cameraProviderFuture.get()
                val preview = Preview.Builder().build().also {
                    it.surfaceProvider = previewView.surfaceProvider
                }
                val recorder = Recorder.Builder()
                    .setQualitySelector(QualitySelector.from(Quality.SD))
                    .build()
                val capture = VideoCapture.withOutput(recorder)
                videoCapture = capture
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_FRONT_CAMERA,
                    preview,
                    capture
                )
            }

            cameraProviderFuture.addListener(listener, executor)

            onDispose {
                activeRecording?.stop()
                activeRecording = null
                isRecording = false
                runCatching { cameraProviderFuture.get().unbindAll() }
            }
        }
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(16.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "Round Video",
            style = MaterialTheme.typography.titleSmall
        )

        if (!hasCameraPermission) {
            Text(
                text = "Camera permission is required for in-app round video capture.",
                style = MaterialTheme.typography.bodySmall
            )
            VostokButton(text = "Grant Camera") {
                permissionLauncher.launch(
                    arrayOf(
                        Manifest.permission.CAMERA,
                        Manifest.permission.RECORD_AUDIO
                    )
                )
            }
            VostokButton(text = "Cancel", onClick = onCancel)
        } else {
            AndroidView(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(240.dp)
                    .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(14.dp)),
                factory = { previewView }
            )

            if (isRecording) {
                Text(
                    text = "Recording… ${elapsedSeconds}s / ${maxDurationSeconds}s",
                    style = MaterialTheme.typography.bodySmall
                )
            } else if (!hasAudioPermission) {
                Text(
                    text = "Microphone permission denied. Video will be captured without audio.",
                    style = MaterialTheme.typography.bodySmall
                )
            }

            lastError?.let { message ->
                Text(
                    text = message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            VostokButton(
                text = if (isRecording) "Stop Capture" else "Start Capture"
            ) {
                if (isRecording) {
                    activeRecording?.stop()
                    return@VostokButton
                }

                val capture = videoCapture ?: return@VostokButton
                val outputFile = File(context.cacheDir, "round-${System.currentTimeMillis()}.mp4")
                currentFile = outputFile
                lastError = null

                var pendingRecording = capture.output.prepareRecording(
                    context,
                    FileOutputOptions.Builder(outputFile).build()
                )
                if (hasAudioPermission) {
                    pendingRecording = pendingRecording.withAudioEnabled()
                }

                activeRecording = pendingRecording.start(ContextCompat.getMainExecutor(context)) { event ->
                    when (event) {
                        is VideoRecordEvent.Start -> {
                            isRecording = true
                        }

                        is VideoRecordEvent.Finalize -> {
                            isRecording = false
                            activeRecording = null

                            if (event.hasError()) {
                                lastError = "Capture failed (${event.error})."
                                runCatching { currentFile?.delete() }
                            } else {
                                val file = currentFile
                                if (file != null) {
                                    val duration = readDurationSecondsFromPath(file.absolutePath)
                                        .coerceAtLeast(elapsedSeconds.coerceAtLeast(1))
                                    onCaptured(file, duration)
                                }
                            }
                        }
                    }
                }
            }

            VostokButton(text = "Cancel", onClick = onCancel)
        }
    }
}

private fun Context.hasPermission(permission: String): Boolean {
    return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
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
