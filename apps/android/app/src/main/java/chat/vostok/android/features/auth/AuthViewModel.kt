package chat.vostok.android.features.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import chat.vostok.android.app.AppState
import chat.vostok.android.core.repository.AuthRepository
import chat.vostok.android.core.storage.StoredSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AuthUiState(
    val username: String = "",
    val deviceId: String = "",
    val deviceName: String = "Android Device",
    val isLoading: Boolean = false,
    val sessionToken: String? = null,
    val error: String? = null,
    val successMessage: String? = null
)

class AuthViewModel(
    private val authRepository: AuthRepository,
    private val appState: AppState
) : ViewModel() {
    private val _uiState = MutableStateFlow(
        AuthUiState(
            deviceId = authRepository.currentSession()?.deviceId.orEmpty(),
            username = authRepository.currentSession()?.username.orEmpty(),
            sessionToken = authRepository.currentSession()?.token
        )
    )
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    fun updateUsername(value: String) {
        _uiState.value = _uiState.value.copy(username = value, error = null, successMessage = null)
    }

    fun updateDeviceId(value: String) {
        _uiState.value = _uiState.value.copy(deviceId = value, error = null, successMessage = null)
    }

    fun updateDeviceName(value: String) {
        _uiState.value = _uiState.value.copy(deviceName = value, error = null, successMessage = null)
    }

    fun register() {
        val state = _uiState.value
        if (state.username.isBlank()) {
            _uiState.value = state.copy(error = "Username is required.")
            return
        }

        executeAuth {
            authRepository.register(username = state.username, deviceName = state.deviceName)
        }
    }

    fun login() {
        val state = _uiState.value
        if (state.deviceId.isBlank()) {
            _uiState.value = state.copy(error = "Device ID is required.")
            return
        }

        executeAuth {
            authRepository.login(deviceId = state.deviceId)
        }
    }

    fun logout() {
        authRepository.logout()
        appState.setSession(null)
        _uiState.value = _uiState.value.copy(sessionToken = null, successMessage = "Logged out", error = null)
    }

    private fun executeAuth(call: suspend () -> StoredSession) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null, successMessage = null)
            runCatching { call() }
                .onSuccess { session ->
                    appState.setSession(session)
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        deviceId = session.deviceId,
                        sessionToken = session.token,
                        successMessage = "Authenticated @${session.username ?: "user"}",
                        error = null
                    )
                }
                .onFailure { throwable ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = throwable.message ?: "Authentication failed"
                    )
                }
        }
    }

    class Factory(
        private val authRepository: AuthRepository,
        private val appState: AppState
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return AuthViewModel(authRepository, appState) as T
        }
    }
}
