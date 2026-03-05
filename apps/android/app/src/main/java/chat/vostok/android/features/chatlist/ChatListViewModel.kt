package chat.vostok.android.features.chatlist

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import chat.vostok.android.core.network.WebSocketManager
import chat.vostok.android.core.repository.ChatListItemModel
import chat.vostok.android.core.repository.ChatRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ChatListUiState(
    val items: List<ChatListItemModel> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

class ChatListViewModel(
    private val chatRepository: ChatRepository,
    private val webSocketManager: WebSocketManager
) : ViewModel() {
    private val _uiState = MutableStateFlow(ChatListUiState())
    val uiState: StateFlow<ChatListUiState> = _uiState.asStateFlow()
    private var realtimeJob: Job? = null

    init {
        refresh()
        subscribeRealtime()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching {
                chatRepository.syncChats()
            }.onSuccess { items ->
                items.forEach { item ->
                    webSocketManager.join("chat:${item.id}")
                    webSocketManager.join("call:${item.id}")
                }
                _uiState.value = ChatListUiState(items = items, isLoading = false)
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = throwable.message ?: "Failed to load chats"
                )
            }
        }
    }

    private fun subscribeRealtime() {
        realtimeJob?.cancel()
        realtimeJob = viewModelScope.launch {
            webSocketManager.events.collect { event ->
                when (event.event) {
                    "message:new", "message:updated" -> {
                        val chatId = event.payload.optString("chat_id").takeIf { it.isNotBlank() }
                        val messageId = event.payload.optString("message_id").takeIf { it.isNotBlank() }
                        if (!chatId.isNullOrBlank()) {
                            runCatching { chatRepository.upsertMessageFromRemote(chatId, messageId.orEmpty()) }
                        }
                        refresh()
                    }

                    "call:state", "call:participant_state", "call:signal" -> {
                        refresh()
                    }
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        realtimeJob?.cancel()
    }

    class Factory(
        private val chatRepository: ChatRepository,
        private val webSocketManager: WebSocketManager
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return ChatListViewModel(chatRepository, webSocketManager) as T
        }
    }
}
