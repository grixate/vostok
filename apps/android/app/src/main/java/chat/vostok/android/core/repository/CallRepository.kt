package chat.vostok.android.core.repository

import chat.vostok.android.core.network.ApiClient
import chat.vostok.android.core.network.CallDto
import chat.vostok.android.core.network.CallSignalDto
import chat.vostok.android.core.network.JoinCallResponse
import chat.vostok.android.core.network.SignalEnvelopeResponse

data class CallStateModel(
    val call: CallDto,
    val participantCount: Int,
    val signalCount: Int
)

class CallRepository(
    private val apiClient: ApiClient
) {
    suspend fun activeCall(chatId: String): CallDto? = apiClient.activeCall(chatId).call

    suspend fun createCall(chatId: String, mode: String): CallDto {
        return apiClient.createCall(chatId = chatId, mode = mode).call
    }

    suspend fun loadState(callId: String): CallStateModel {
        val state = apiClient.callState(callId)
        return CallStateModel(
            call = state.call,
            participantCount = state.participants.size,
            signalCount = state.signals.size
        )
    }

    suspend fun joinCall(
        callId: String,
        trackKind: String,
        e2eeCapable: Boolean? = null,
        e2eeAlgorithm: String? = null,
        e2eeKeyEpoch: Int? = null
    ): JoinCallResponse {
        return apiClient.joinCall(
            callId = callId,
            trackKind = trackKind,
            e2eeCapable = e2eeCapable,
            e2eeAlgorithm = e2eeAlgorithm,
            e2eeKeyEpoch = e2eeKeyEpoch
        )
    }

    suspend fun leaveCall(callId: String): JoinCallResponse = apiClient.leaveCall(callId)

    suspend fun endCall(callId: String): CallDto = apiClient.endCall(callId).call

    suspend fun signals(callId: String): List<CallSignalDto> = apiClient.callSignals(callId).signals

    suspend fun emitSignal(
        callId: String,
        signalType: String,
        payload: String,
        targetDeviceId: String? = null
    ): SignalEnvelopeResponse {
        return apiClient.emitCallSignal(callId, signalType, payload, targetDeviceId)
    }
}
