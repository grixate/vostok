package chat.vostok.android.features.calls

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import chat.vostok.android.core.network.WebSocketManager
import chat.vostok.android.core.network.CallSignalDto
import chat.vostok.android.core.repository.CallRepository
import chat.vostok.android.core.repository.CallStateModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class CallUiState(
    val chatId: String = "",
    val callId: String = "",
    val mode: String = "voice",
    val state: CallStateModel? = null,
    val signals: List<CallSignalDto> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val info: String? = null
)

class CallViewModel(
    private val callRepository: CallRepository,
    private val webSocketManager: WebSocketManager
) : ViewModel() {
    private val _uiState = MutableStateFlow(CallUiState())
    val uiState: StateFlow<CallUiState> = _uiState.asStateFlow()
    private var realtimeJob: Job? = null

    init {
        subscribeRealtime()
    }

    fun updateChatId(value: String) {
        _uiState.value = _uiState.value.copy(chatId = value)
    }

    fun updateCallId(value: String) {
        _uiState.value = _uiState.value.copy(callId = value)
    }

    fun updateMode(value: String) {
        val normalized = when (value) {
            "video", "group" -> value
            else -> "voice"
        }
        _uiState.value = _uiState.value.copy(mode = normalized)
    }

    fun startOrAttach() {
        val chatId = _uiState.value.chatId.trim()
        if (chatId.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Chat ID is required")
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null, info = null)
            runCatching {
                val active = callRepository.activeCall(chatId)
                active ?: callRepository.createCall(chatId, _uiState.value.mode)
            }.onSuccess { call ->
                _uiState.value = _uiState.value.copy(
                    callId = call.id,
                    chatId = chatId,
                    mode = call.mode,
                    isLoading = false
                )
                refresh()
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = throwable.message ?: "Failed to start call"
                )
            }
        }
    }

    fun refresh() {
        val callId = _uiState.value.callId.trim()
        if (callId.isBlank()) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching {
                val state = callRepository.loadState(callId)
                val signals = callRepository.signals(callId)
                state to signals
            }.onSuccess { (state, signals) ->
                _uiState.value = _uiState.value.copy(
                    state = state,
                    signals = signals,
                    isLoading = false
                )
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = throwable.message ?: "Failed to load call"
                )
            }
        }
    }

    fun join(trackKind: String) {
        val callId = _uiState.value.callId.trim()
        if (callId.isBlank()) return

        viewModelScope.launch {
            runCatching {
                val groupJoin = _uiState.value.mode == "group"
                callRepository.joinCall(
                    callId = callId,
                    trackKind = trackKind,
                    e2eeCapable = if (groupJoin) true else null,
                    e2eeAlgorithm = if (groupJoin) "sframe-aes-gcm-v1" else null,
                    e2eeKeyEpoch = if (groupJoin) 0 else null
                )
            }.onSuccess {
                _uiState.value = _uiState.value.copy(info = "Joined call")
                refresh()
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to join")
            }
        }
    }

    fun leave() {
        val callId = _uiState.value.callId.trim()
        if (callId.isBlank()) return

        viewModelScope.launch {
            runCatching { callRepository.leaveCall(callId) }
                .onSuccess {
                    _uiState.value = _uiState.value.copy(info = "Left call")
                    refresh()
                }
                .onFailure { throwable ->
                    _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to leave")
                }
        }
    }

    fun end() {
        val callId = _uiState.value.callId.trim()
        if (callId.isBlank()) return

        viewModelScope.launch {
            runCatching { callRepository.endCall(callId) }
                .onSuccess {
                    _uiState.value = _uiState.value.copy(info = "Call ended")
                    refresh()
                }
                .onFailure { throwable ->
                    _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to end")
                }
        }
    }

    fun sendHeartbeat() {
        val callId = _uiState.value.callId.trim()
        if (callId.isBlank()) return

        viewModelScope.launch {
            runCatching {
                callRepository.emitSignal(
                    callId = callId,
                    signalType = "heartbeat",
                    payload = "android-heartbeat"
                )
            }.onSuccess {
                _uiState.value = _uiState.value.copy(info = "Heartbeat signal sent")
                refresh()
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to signal")
            }
        }
    }

    private fun subscribeRealtime() {
        realtimeJob?.cancel()
        realtimeJob = viewModelScope.launch {
            webSocketManager.events.collect { event ->
                when (event.event) {
                    "call:state" -> {
                        val currentCallId = _uiState.value.callId
                        val payloadCallId = event.payload
                            .optJSONObject("call")
                            ?.optString("id")
                            .orEmpty()
                        if (currentCallId.isNotBlank() && payloadCallId == currentCallId) {
                            refresh()
                        }
                    }

                    "call:participant_state", "call:signal" -> {
                        val currentCallId = _uiState.value.callId
                        val payloadCallId = event.payload.optString("call_id")
                        if (currentCallId.isNotBlank() && payloadCallId == currentCallId) {
                            refresh()
                        }
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
        private val callRepository: CallRepository,
        private val webSocketManager: WebSocketManager
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return CallViewModel(callRepository, webSocketManager) as T
        }
    }
}
