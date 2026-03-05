package chat.vostok.android.features.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import chat.vostok.android.core.network.DeviceDto
import chat.vostok.android.core.repository.DeviceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SettingsUiState(
    val devices: List<DeviceDto> = emptyList(),
    val readReceipts: Boolean = true,
    val biometricLock: Boolean = false,
    val isLoadingDevices: Boolean = false,
    val error: String? = null,
    val info: String? = null
)

class SettingsViewModel(
    private val deviceRepository: DeviceRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    fun refreshDevices() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingDevices = true, error = null, info = null)
            runCatching { deviceRepository.listDevices() }
                .onSuccess { devices ->
                    _uiState.value = _uiState.value.copy(devices = devices, isLoadingDevices = false)
                }
                .onFailure { throwable ->
                    _uiState.value = _uiState.value.copy(
                        isLoadingDevices = false,
                        error = throwable.message ?: "Failed to load devices"
                    )
                }
        }
    }

    fun revokeDevice(deviceId: String) {
        viewModelScope.launch {
            runCatching { deviceRepository.revokeDevice(deviceId) }
                .onSuccess { revoked ->
                    _uiState.value = _uiState.value.copy(info = "Revoked ${revoked.deviceName}")
                    refreshDevices()
                }
                .onFailure { throwable ->
                    _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to revoke device")
                }
        }
    }

    fun setReadReceipts(enabled: Boolean) {
        _uiState.value = _uiState.value.copy(readReceipts = enabled)
    }

    fun setBiometricLock(enabled: Boolean) {
        _uiState.value = _uiState.value.copy(biometricLock = enabled)
    }

    class Factory(
        private val deviceRepository: DeviceRepository
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return SettingsViewModel(deviceRepository) as T
        }
    }
}
