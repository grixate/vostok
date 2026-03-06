package chat.vostok.android.features.conversation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import chat.vostok.android.core.network.MessageDto
import chat.vostok.android.core.network.WebSocketManager
import chat.vostok.android.core.repository.MediaRepository
import chat.vostok.android.core.repository.MessageRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ConversationUiState(
    val messages: List<MessageDto> = emptyList(),
    val composer: String = "",
    val editingMessageId: String? = null,
    val isLoading: Boolean = false,
    val error: String? = null
)

class ConversationViewModel(
    private val messageRepository: MessageRepository,
    private val mediaRepository: MediaRepository,
    private val webSocketManager: WebSocketManager
) : ViewModel() {
    private val _uiState = MutableStateFlow(ConversationUiState())
    val uiState: StateFlow<ConversationUiState> = _uiState.asStateFlow()

    private var realtimeJob: Job? = null

    fun previewText(message: MessageDto): String = messageRepository.decodeCiphertextPreview(message)

    fun updateComposer(text: String) {
        _uiState.value = _uiState.value.copy(composer = text)
    }

    fun startEdit(message: MessageDto) {
        _uiState.value = _uiState.value.copy(
            editingMessageId = message.id,
            composer = messageRepository.decodeCiphertextPreview(message)
        )
    }

    fun cancelEdit() {
        _uiState.value = _uiState.value.copy(editingMessageId = null, composer = "")
    }

    fun load(chatId: String) {
        subscribeRealtime(chatId)

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching {
                messageRepository.flushPending(chatId)
                messageRepository.syncChat(chatId)
            }.onSuccess { messages ->
                syncReadState(chatId, messages)
                _uiState.value = _uiState.value.copy(messages = messages, isLoading = false)
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = throwable.message ?: "Failed to load messages"
                )
            }
        }
    }

    fun send(chatId: String, recipientDeviceIds: List<String>) {
        val text = _uiState.value.composer.trim()
        if (text.isEmpty()) return

        val editingMessageId = _uiState.value.editingMessageId
        viewModelScope.launch {
            runCatching {
                if (editingMessageId.isNullOrBlank()) {
                    messageRepository.sendTextMessage(chatId, text, recipientDeviceIds)
                } else {
                    messageRepository.editTextMessage(chatId, editingMessageId, text, recipientDeviceIds)
                }
            }.onSuccess {
                _uiState.value = _uiState.value.copy(composer = "", editingMessageId = null)
                load(chatId)
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to send")
            }
        }
    }

    fun delete(chatId: String, messageId: String) {
        viewModelScope.launch {
            runCatching {
                messageRepository.deleteMessage(chatId, messageId)
            }.onSuccess {
                load(chatId)
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to delete")
            }
        }
    }

    fun togglePin(chatId: String, messageId: String) {
        viewModelScope.launch {
            runCatching {
                messageRepository.togglePin(chatId, messageId)
            }.onSuccess {
                load(chatId)
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to toggle pin")
            }
        }
    }

    fun toggleReaction(chatId: String, messageId: String, reactionKey: String = "👍") {
        viewModelScope.launch {
            runCatching {
                messageRepository.toggleReaction(chatId, messageId, reactionKey)
            }.onSuccess {
                load(chatId)
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to react")
            }
        }
    }

    fun sendVoice(chatId: String, recipientDeviceIds: List<String>, durationSeconds: Int = 4) {
        viewModelScope.launch {
            runCatching {
                messageRepository.sendVoiceNoteMessage(
                    chatId = chatId,
                    durationSeconds = durationSeconds.coerceAtLeast(1),
                    recipientDeviceIds = recipientDeviceIds
                )
            }.onSuccess {
                load(chatId)
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to send voice")
            }
        }
    }

    fun sendVoiceUpload(
        chatId: String,
        filename: String,
        contentType: String,
        payload: ByteArray,
        durationSeconds: Int,
        recipientDeviceIds: List<String>
    ) {
        viewModelScope.launch {
            runCatching {
                val upload = mediaRepository.uploadBytes(
                    filename = filename,
                    contentType = contentType,
                    payload = payload,
                    mediaKind = "audio"
                )
                messageRepository.sendVoiceNoteUploadMessage(
                    chatId = chatId,
                    uploadId = upload.id,
                    filename = upload.filename,
                    contentType = upload.contentType,
                    durationSeconds = durationSeconds.coerceAtLeast(1),
                    recipientDeviceIds = recipientDeviceIds
                )
            }.onSuccess {
                load(chatId)
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to send voice")
            }
        }
    }

    fun sendRoundVideo(chatId: String, recipientDeviceIds: List<String>, durationSeconds: Int = 6) {
        viewModelScope.launch {
            runCatching {
                messageRepository.sendRoundVideoMessage(
                    chatId = chatId,
                    durationSeconds = durationSeconds.coerceAtLeast(1),
                    recipientDeviceIds = recipientDeviceIds
                )
            }.onSuccess {
                load(chatId)
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to send video")
            }
        }
    }

    fun sendRoundVideoUpload(
        chatId: String,
        filename: String,
        contentType: String,
        payload: ByteArray,
        durationSeconds: Int,
        recipientDeviceIds: List<String>
    ) {
        viewModelScope.launch {
            runCatching {
                val upload = mediaRepository.uploadBytes(
                    filename = filename,
                    contentType = contentType,
                    payload = payload,
                    mediaKind = "video"
                )
                messageRepository.sendRoundVideoUploadMessage(
                    chatId = chatId,
                    uploadId = upload.id,
                    filename = upload.filename,
                    contentType = upload.contentType,
                    durationSeconds = durationSeconds.coerceAtLeast(1),
                    recipientDeviceIds = recipientDeviceIds
                )
            }.onSuccess {
                load(chatId)
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to send video")
            }
        }
    }

    private fun subscribeRealtime(chatId: String) {
        realtimeJob?.cancel()
        realtimeJob = viewModelScope.launch {
            webSocketManager.events.collect { event ->
                when {
                    event.event == "socket:reconnected" -> {
                        runCatching {
                            messageRepository.syncChat(chatId)
                        }.onSuccess { updated ->
                            syncReadState(chatId, updated)
                            _uiState.value = _uiState.value.copy(messages = updated, error = null)
                        }
                    }

                    event.topic == "chat:$chatId" && event.event == "message:new" -> {
                        val messageId = event.payload.optString("message_id").takeIf { it.isNotBlank() }
                        runCatching {
                            messageRepository.ingestRealtimeMessage(chatId, messageId)
                        }.onSuccess { updated ->
                            syncReadState(chatId, updated)
                            _uiState.value = _uiState.value.copy(messages = updated)
                        }
                    }
                }
            }
        }
    }

    private suspend fun syncReadState(chatId: String, messages: List<MessageDto>) {
        val lastMessageId = messages.lastOrNull()?.id ?: return
        runCatching {
            messageRepository.markChatRead(chatId = chatId, lastReadMessageId = lastMessageId)
        }
    }

    override fun onCleared() {
        super.onCleared()
        realtimeJob?.cancel()
    }

    class Factory(
        private val messageRepository: MessageRepository,
        private val mediaRepository: MediaRepository,
        private val webSocketManager: WebSocketManager
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return ConversationViewModel(messageRepository, mediaRepository, webSocketManager) as T
        }
    }
}
