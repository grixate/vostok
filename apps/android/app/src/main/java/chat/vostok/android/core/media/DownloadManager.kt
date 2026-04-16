package chat.vostok.android.core.media

import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Centralized download manager for media attachments.
 * Manages a concurrent download queue with progress tracking,
 * network-aware auto-download, and cancellation support.
 *
 * Thread-safe: uses ConcurrentHashMap + AtomicInteger for shared state.
 */
class DownloadManager(
    private val cacheDir: File,
    private val connectivityManager: ConnectivityManager?,
) {
    sealed class DownloadState {
        data object Idle : DownloadState()
        data object AutoQueued : DownloadState()
        data class Downloading(val progress: Float) : DownloadState()
        data object Decrypting : DownloadState()
        data class Ready(val localPath: String) : DownloadState()
        data class Error(val message: String) : DownloadState()
        data object Expired : DownloadState()
        data object Cancelled : DownloadState()
    }

    data class DownloadTask(
        val uploadId: String,
        val keyMaterialBase64: String,
        val fileName: String,
        val contentType: String,
        val byteSize: Int,
        @Volatile var state: DownloadState = DownloadState.Idle,
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val tasks = ConcurrentHashMap<String, DownloadTask>()
    private val pendingQueue = java.util.concurrent.ConcurrentLinkedQueue<String>()
    private val activeCount = AtomicInteger(0)
    private val maxConcurrent = 3

    private val _taskStates = MutableStateFlow<Map<String, DownloadState>>(emptyMap())
    val taskStates: StateFlow<Map<String, DownloadState>> = _taskStates.asStateFlow()

    fun stateFor(uploadId: String): DownloadState = _taskStates.value[uploadId] ?: DownloadState.Idle

    fun enqueue(
        uploadId: String,
        keyMaterialBase64: String,
        fileName: String,
        contentType: String,
        byteSize: Int,
        downloadAction: suspend (String, (Float) -> Unit) -> ByteArray,
    ) {
        val existing = tasks[uploadId]
        if (existing != null) {
            when (existing.state) {
                is DownloadState.Downloading, DownloadState.Decrypting,
                is DownloadState.Ready, DownloadState.AutoQueued -> return
                else -> {}
            }
        }

        val task = DownloadTask(uploadId, keyMaterialBase64, fileName, contentType, byteSize)
        task.state = DownloadState.AutoQueued
        tasks[uploadId] = task
        updateState(uploadId, DownloadState.AutoQueued)
        pendingQueue.add(uploadId)
        processQueue(downloadAction)
    }

    fun cancel(uploadId: String) {
        pendingQueue.remove(uploadId)
        tasks[uploadId]?.let {
            it.state = DownloadState.Cancelled
            updateState(uploadId, DownloadState.Cancelled)
        }
    }

    /** Must be called when the manager is no longer needed to prevent coroutine leaks. */
    fun shutdown() {
        scope.cancel()
    }

    private fun processQueue(downloadAction: suspend (String, (Float) -> Unit) -> ByteArray) {
        while (activeCount.get() < maxConcurrent) {
            val nextId = pendingQueue.poll() ?: break
            val task = tasks[nextId] ?: continue
            activeCount.incrementAndGet()

            scope.launch {
                try {
                    executeDownload(nextId, task, downloadAction)
                } finally {
                    activeCount.decrementAndGet()
                    // Try to process more items after this one finishes
                    processQueue(downloadAction)
                }
            }
        }
    }

    private suspend fun executeDownload(
        uploadId: String,
        task: DownloadTask,
        downloadAction: suspend (String, (Float) -> Unit) -> ByteArray,
    ) {
        updateState(uploadId, DownloadState.Downloading(0f))
        task.state = DownloadState.Downloading(0f)

        try {
            val data = downloadAction(uploadId) { progress ->
                updateState(uploadId, DownloadState.Downloading(progress))
                task.state = DownloadState.Downloading(progress)
            }

            updateState(uploadId, DownloadState.Decrypting)
            task.state = DownloadState.Decrypting

            val mediaDir = File(cacheDir, "VostokMedia").apply { mkdirs() }
            val file = File(mediaDir, task.fileName)
            file.writeBytes(data)

            val readyState = DownloadState.Ready(file.absolutePath)
            task.state = readyState
            updateState(uploadId, readyState)
        } catch (e: Exception) {
            val errorState = DownloadState.Error(e.message ?: "Download failed")
            task.state = errorState
            updateState(uploadId, errorState)
        }
    }

    private fun updateState(uploadId: String, state: DownloadState) {
        _taskStates.value = _taskStates.value + (uploadId to state)
    }

    // MARK: – Network helpers

    val isWifi: Boolean get() {
        val network = connectivityManager?.activeNetwork ?: return false
        val caps = connectivityManager.getNetworkCapabilities(network) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    val isCellular: Boolean get() {
        val network = connectivityManager?.activeNetwork ?: return false
        val caps = connectivityManager.getNetworkCapabilities(network) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
    }

    val isConnected: Boolean get() {
        val network = connectivityManager?.activeNetwork ?: return false
        val caps = connectivityManager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun shouldAutoDownload(config: AutoDownloadMediaConfig, byteSize: Int): Boolean {
        if (!isConnected) return false
        if (config.maxSizeBytes <= 0) return false
        if (byteSize > config.maxSizeBytes) return false
        if (isCellular && !config.onCellular) return false
        return true
    }
}

// MARK: – Auto-Download Settings

data class AutoDownloadMediaConfig(
    val maxSizeBytes: Int = 0,
    val onCellular: Boolean = false,
) {
    val isEnabled: Boolean get() = maxSizeBytes > 0
}

data class AutoDownloadChatConfig(
    val photos: AutoDownloadMediaConfig = AutoDownloadMediaConfig(5_242_880, true),
    val videos: AutoDownloadMediaConfig = AutoDownloadMediaConfig(0, false),
    val files: AutoDownloadMediaConfig = AutoDownloadMediaConfig(0, false),
    val voiceMessages: AutoDownloadMediaConfig = AutoDownloadMediaConfig(5_242_880, true),
    val roundVideos: AutoDownloadMediaConfig = AutoDownloadMediaConfig(0, false),
)

data class AutoDownloadSettings(
    val privateChats: AutoDownloadChatConfig = AutoDownloadChatConfig(),
    val groupChats: AutoDownloadChatConfig = AutoDownloadChatConfig(),
)
