package chat.vostok.android.core.repository

import chat.vostok.android.core.network.ApiClient
import chat.vostok.android.core.network.DeviceDto

class DeviceRepository(
    private val apiClient: ApiClient
) {
    suspend fun listDevices(): List<DeviceDto> = apiClient.devices().devices

    suspend fun revokeDevice(deviceId: String): DeviceDto = apiClient.revokeDevice(deviceId).device
}
