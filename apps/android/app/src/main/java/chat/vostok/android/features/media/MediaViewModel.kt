package chat.vostok.android.features.media

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import chat.vostok.android.core.network.LinkMetadataDto
import chat.vostok.android.core.network.MediaUploadDto
import chat.vostok.android.core.repository.MediaRepository
import chat.vostok.android.core.repository.MessageRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.nio.charset.StandardCharsets

data class MediaUiState(
    val filename: String = "note.txt",
    val payloadText: String = "",
    val linkUrl: String = "",
    val latestUpload: MediaUploadDto? = null,
    val metadata: LinkMetadataDto? = null,
    val cachedPath: String? = null,
    val isLoading: Boolean = false,
    val info: String? = null,
    val error: String? = null
)

class MediaViewModel(
    private val mediaRepository: MediaRepository,
    private val messageRepository: MessageRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(MediaUiState())
    val uiState: StateFlow<MediaUiState> = _uiState.asStateFlow()

    fun updateFilename(value: String) {
        _uiState.value = _uiState.value.copy(filename = value, error = null, info = null)
    }

    fun updatePayloadText(value: String) {
        _uiState.value = _uiState.value.copy(payloadText = value, error = null, info = null)
    }

    fun updateLinkUrl(value: String) {
        _uiState.value = _uiState.value.copy(linkUrl = value, error = null, info = null)
    }

    fun uploadTextAsFile() {
        val fileName = _uiState.value.filename.trim().ifBlank { "note.txt" }
        val text = _uiState.value.payloadText
        if (text.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Payload text is empty")
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null, info = null)
            runCatching {
                mediaRepository.uploadBytes(
                    filename = fileName,
                    contentType = "text/plain",
                    payload = text.toByteArray(StandardCharsets.UTF_8),
                    mediaKind = "file"
                )
            }.onSuccess { upload ->
                val cachedFile = mediaRepository.cachedUploadFile(upload.id)
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    latestUpload = upload,
                    cachedPath = cachedFile.absolutePath,
                    info = "Uploaded ${upload.filename} (${upload.uploadedByteSize} bytes)"
                )
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = throwable.message ?: "Media upload failed"
                )
            }
        }
    }

    fun refreshUpload() {
        val uploadId = _uiState.value.latestUpload?.id ?: return
        loadUpload(uploadId)
    }

    fun loadUpload(uploadId: String) {
        viewModelScope.launch {
            runCatching { mediaRepository.fetchUpload(uploadId) }
                .onSuccess { upload ->
                    _uiState.value = _uiState.value.copy(
                        latestUpload = upload,
                        cachedPath = mediaRepository.cachedUploadFile(upload.id).absolutePath,
                        info = "Upload status: ${upload.status}",
                        error = null
                    )
                }
                .onFailure { throwable ->
                    _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to refresh upload")
                }
        }
    }

    fun fetchLinkMetadata() {
        val url = _uiState.value.linkUrl.trim()
        if (url.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "URL is required")
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null, info = null)
            runCatching { mediaRepository.linkMetadata(url) }
                .onSuccess { metadata ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        metadata = metadata,
                        info = "Metadata fetched",
                        error = null
                    )
                }
                .onFailure { throwable ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = throwable.message ?: "Failed to fetch metadata"
                    )
                }
        }
    }

    fun sendLatestUploadToChat(chatId: String) {
        val upload = _uiState.value.latestUpload ?: run {
            _uiState.value = _uiState.value.copy(error = "No upload to send")
            return
        }

        viewModelScope.launch {
            runCatching {
                messageRepository.sendMediaMessage(
                    chatId = chatId,
                    uploadId = upload.id,
                    filename = upload.filename,
                    contentType = upload.contentType,
                    recipientDeviceIds = emptyList()
                )
            }.onSuccess {
                _uiState.value = _uiState.value.copy(info = "Media message sent to chat", error = null)
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to send media message")
            }
        }
    }

    class Factory(
        private val mediaRepository: MediaRepository,
        private val messageRepository: MessageRepository
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return MediaViewModel(mediaRepository, messageRepository) as T
        }
    }
}
