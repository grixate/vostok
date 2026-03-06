package chat.vostok.android.core.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min
import kotlin.random.Random

data class PhoenixEvent(
    val topic: String,
    val event: String,
    val payload: JSONObject
)

enum class SocketConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    RECONNECTING,
    PAUSED
}

data class SocketDiagnostics(
    val reconnectAttempt: Int = 0,
    val networkAvailable: Boolean = true,
    val lastDisconnectCode: Int? = null,
    val lastDisconnectReason: String? = null,
    val lastInboundAtMs: Long = 0L
)

class WebSocketManager(
    private val socketUrl: String
) {
    private val client = OkHttpClient()
    private val refCounter = AtomicLong(1)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var socket: WebSocket? = null
    private var authToken: String? = null
    private var heartbeatJob: Job? = null
    private var reconnectJob: Job? = null
    private var reconnectAttempt = 0
    private var isPaused = false
    private var hasEverConnected = false
    private var networkAvailable = true
    private var lastInboundAtMs = 0L
    private val joinedTopics = linkedSetOf<String>()

    private val _events = MutableSharedFlow<PhoenixEvent>(extraBufferCapacity = 256)
    val events: SharedFlow<PhoenixEvent> = _events.asSharedFlow()

    private val _connectionState = MutableStateFlow(SocketConnectionState.DISCONNECTED)
    val connectionState: StateFlow<SocketConnectionState> = _connectionState.asStateFlow()

    private val _diagnostics = MutableStateFlow(SocketDiagnostics())
    val diagnostics: StateFlow<SocketDiagnostics> = _diagnostics.asStateFlow()

    private val _diagnosticLog = MutableStateFlow<List<String>>(emptyList())
    val diagnosticLog: StateFlow<List<String>> = _diagnosticLog.asStateFlow()

    fun connect(token: String) {
        authToken = token
        isPaused = false
        recordDiagnostic("connect() called")
        if (!networkAvailable) {
            _connectionState.value = SocketConnectionState.DISCONNECTED
            recordDiagnostic("connect aborted: network unavailable")
            return
        }
        if (socket != null) return
        reconnectJob?.cancel()
        reconnectJob = null
        openSocket(isReconnect = hasEverConnected)
    }

    fun disconnect() {
        authToken = null
        isPaused = false
        recordDiagnostic("disconnect() called")
        reconnectAttempt = 0
        reconnectJob?.cancel()
        reconnectJob = null
        heartbeatJob?.cancel()
        heartbeatJob = null
        socket?.close(1000, "manual_disconnect")
        socket = null
        joinedTopics.clear()
        _connectionState.value = SocketConnectionState.DISCONNECTED
    }

    fun forceReconnect(reason: String = "manual_reconnect") {
        recordDiagnostic("forceReconnect() reason=$reason")
        if (authToken.isNullOrBlank() || isPaused) return
        socket?.close(1000, reason)
        socket = null
        heartbeatJob?.cancel()
        heartbeatJob = null
        reconnectJob?.cancel()
        reconnectJob = null
        scheduleReconnect(immediate = true)
    }

    fun clearDiagnosticLog() {
        _diagnosticLog.value = emptyList()
        recordDiagnostic("diagnostic log cleared")
    }

    fun pause() {
        if (isPaused) return
        isPaused = true
        recordDiagnostic("pause() called")
        reconnectJob?.cancel()
        reconnectJob = null
        heartbeatJob?.cancel()
        heartbeatJob = null
        socket?.close(1000, "app_background")
        socket = null
        _connectionState.value = SocketConnectionState.PAUSED
    }

    fun resume() {
        if (!isPaused) return
        isPaused = false
        recordDiagnostic("resume() called")
        if (!authToken.isNullOrBlank() && networkAvailable && socket == null) {
            openSocket(isReconnect = true)
        }
    }

    fun updateNetworkAvailability(isAvailable: Boolean) {
        if (networkAvailable == isAvailable) return
        networkAvailable = isAvailable
        _diagnostics.value = _diagnostics.value.copy(networkAvailable = isAvailable)
        recordDiagnostic("network availability changed: $isAvailable")

        if (isAvailable) {
            emitSystemEvent("socket:network_available")
            if (!authToken.isNullOrBlank() && !isPaused && socket == null) {
                reconnectJob?.cancel()
                reconnectJob = null
                scheduleReconnect(immediate = true)
            }
            return
        }

        emitSystemEvent("socket:network_unavailable")
        reconnectJob?.cancel()
        reconnectJob = null
        socket?.close(1000, "network_unavailable")
        socket = null
        heartbeatJob?.cancel()
        heartbeatJob = null
        _connectionState.value = SocketConnectionState.DISCONNECTED
    }

    fun join(topic: String) {
        joinedTopics += topic
        if (connectionState.value == SocketConnectionState.CONNECTED) {
            push(topic = topic, event = "phx_join", payload = JSONObject())
        }
    }

    fun leave(topic: String) {
        if (joinedTopics.remove(topic) && connectionState.value == SocketConnectionState.CONNECTED) {
            push(topic = topic, event = "phx_leave", payload = JSONObject())
        }
    }

    fun push(topic: String, event: String, payload: JSONObject): Boolean {
        val current = socket ?: return false
        val ref = refCounter.getAndIncrement().toString()
        val joinRef = if (event == "phx_join") ref else JSONObject.NULL

        val frame = JSONArray()
            .put(joinRef)
            .put(ref)
            .put(topic)
            .put(event)
            .put(payload)

        return current.send(frame.toString())
    }

    private fun openSocket(isReconnect: Boolean) {
        val token = authToken ?: return
        if (isPaused || !networkAvailable) return
        if (socket != null) return
        recordDiagnostic("opening socket (reconnect=$isReconnect)")

        _connectionState.value = if (isReconnect) {
            SocketConnectionState.RECONNECTING
        } else {
            SocketConnectionState.CONNECTING
        }

        val url = if (socketUrl.contains("?")) {
            "$socketUrl&token=$token&vsn=2.0.0"
        } else {
            "$socketUrl?token=$token&vsn=2.0.0"
        }

        socket = client.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    reconnectAttempt = 0
                    reconnectJob?.cancel()
                    reconnectJob = null
                    lastInboundAtMs = System.currentTimeMillis()
                    _diagnostics.value = _diagnostics.value.copy(
                        reconnectAttempt = 0,
                        lastInboundAtMs = lastInboundAtMs
                    )
                    _connectionState.value = SocketConnectionState.CONNECTED
                    recordDiagnostic("socket opened")
                    val reconnectEvent = hasEverConnected
                    hasEverConnected = true
                    emitSystemEvent(if (reconnectEvent) "socket:reconnected" else "socket:connected")
                    startHeartbeat()
                    joinedTopics.toList().forEach { topic ->
                        push(topic = topic, event = "phx_join", payload = JSONObject())
                    }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    lastInboundAtMs = System.currentTimeMillis()
                    _diagnostics.value = _diagnostics.value.copy(lastInboundAtMs = lastInboundAtMs)
                    runCatching {
                        parseEvent(text)
                    }.getOrNull()?.let { event ->
                        _events.tryEmit(event)
                    }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    socket = null
                    heartbeatJob?.cancel()
                    heartbeatJob = null
                    handleSocketDrop(code = code, reason = reason)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    socket = null
                    heartbeatJob?.cancel()
                    heartbeatJob = null
                    handleSocketDrop(code = -1, reason = t.message ?: "failure")
                }
            }
        )
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (true) {
                delay(25_000)
                val idleDurationMs = System.currentTimeMillis() - lastInboundAtMs
                if (idleDurationMs > 90_000L) {
                    recordDiagnostic("socket marked stale after ${idleDurationMs}ms idle")
                    emitSystemEvent(
                        event = "socket:stale",
                        payload = JSONObject().put("idle_ms", idleDurationMs)
                    )
                    socket?.cancel()
                    return@launch
                }

                val sent = push(topic = "phoenix", event = "heartbeat", payload = JSONObject())
                if (!sent) return@launch
            }
        }
    }

    private fun handleSocketDrop(code: Int, reason: String) {
        recordDiagnostic("socket dropped: code=$code reason=$reason")
        _diagnostics.value = _diagnostics.value.copy(
            lastDisconnectCode = code,
            lastDisconnectReason = reason
        )

        emitSystemEvent(
            event = "socket:disconnected",
            payload = JSONObject()
                .put("code", code)
                .put("reason", reason)
        )

        val hasAuthToken = !authToken.isNullOrBlank()
        _connectionState.value = stateAfterSocketDrop(
            isPaused = isPaused,
            networkAvailable = networkAvailable,
            hasAuthToken = hasAuthToken
        )

        if (shouldScheduleReconnectAfterDrop(
                isPaused = isPaused,
                networkAvailable = networkAvailable,
                hasAuthToken = hasAuthToken
            )
        ) {
            scheduleReconnect()
        }
    }

    private fun scheduleReconnect(immediate: Boolean = false) {
        if (reconnectJob?.isActive == true) return
        reconnectJob = scope.launch {
            while (!authToken.isNullOrBlank() && !isPaused && socket == null) {
                if (!networkAvailable) {
                    delay(1_000)
                    continue
                }

                reconnectAttempt += 1
                _diagnostics.value = _diagnostics.value.copy(reconnectAttempt = reconnectAttempt)
                _connectionState.value = SocketConnectionState.RECONNECTING
                val reconnectDelayMs = reconnectDelayMs(
                    attempt = reconnectAttempt,
                    immediate = immediate && reconnectAttempt == 1,
                    jitterMs = Random.nextLong(0L, 600L)
                )
                emitSystemEvent(
                    event = "socket:reconnect_attempt",
                    payload = JSONObject()
                        .put("attempt", reconnectAttempt)
                        .put("delay_ms", reconnectDelayMs)
                )
                recordDiagnostic("reconnect attempt=$reconnectAttempt delay_ms=$reconnectDelayMs")
                delay(reconnectDelayMs)
                openSocket(isReconnect = true)
                if (socket != null) return@launch
            }
        }
    }

    internal fun reconnectDelayMs(attempt: Int, immediate: Boolean, jitterMs: Long): Long {
        if (immediate) return 0L
        val clampedAttempt = min(attempt.coerceAtLeast(1), 6)
        val baseDelay = min(60_000L, 1_000L * (1L shl clampedAttempt))
        val clampedJitter = jitterMs.coerceIn(0L, 600L)
        return baseDelay + clampedJitter
    }

    internal fun shouldScheduleReconnectAfterDrop(
        isPaused: Boolean,
        networkAvailable: Boolean,
        hasAuthToken: Boolean
    ): Boolean {
        return !isPaused && networkAvailable && hasAuthToken
    }

    internal fun stateAfterSocketDrop(
        isPaused: Boolean,
        networkAvailable: Boolean,
        hasAuthToken: Boolean
    ): SocketConnectionState {
        return when {
            isPaused -> SocketConnectionState.PAUSED
            !networkAvailable || !hasAuthToken -> SocketConnectionState.DISCONNECTED
            else -> SocketConnectionState.RECONNECTING
        }
    }

    private fun recordDiagnostic(message: String) {
        val line = "${Instant.now()} $message"
        _diagnosticLog.value = (_diagnosticLog.value + line).takeLast(80)
    }

    private fun emitSystemEvent(event: String, payload: JSONObject = JSONObject()) {
        _events.tryEmit(PhoenixEvent(topic = "system", event = event, payload = payload))
    }

    private fun parseEvent(raw: String): PhoenixEvent {
        val trimmed = raw.trim()
        if (trimmed.startsWith("[")) {
            val frame = JSONArray(trimmed)
            val topic = frame.optString(2)
            val event = frame.optString(3)
            val payload = frame.optJSONObject(4) ?: JSONObject()
            return PhoenixEvent(topic = topic, event = event, payload = payload)
        }

        val json = JSONObject(trimmed)
        val topic = json.optString("topic", "")
        val event = json.optString("event", "")
        val payload = json.optJSONObject("payload") ?: JSONObject()
        return PhoenixEvent(topic = topic, event = event, payload = payload)
    }
}
