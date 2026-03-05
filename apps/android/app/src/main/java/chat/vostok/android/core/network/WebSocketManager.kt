package chat.vostok.android.core.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

data class PhoenixEvent(
    val topic: String,
    val event: String,
    val payload: JSONObject
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
    private val joinedTopics = linkedSetOf<String>()

    private val _events = MutableSharedFlow<PhoenixEvent>(extraBufferCapacity = 256)
    val events: SharedFlow<PhoenixEvent> = _events

    fun connect(token: String) {
        authToken = token
        if (socket != null) return
        openSocket()
    }

    fun disconnect() {
        authToken = null
        reconnectJob?.cancel()
        reconnectJob = null
        heartbeatJob?.cancel()
        heartbeatJob = null
        socket?.close(1000, "normal")
        socket = null
        joinedTopics.clear()
    }

    fun join(topic: String) {
        joinedTopics += topic
        push(topic = topic, event = "phx_join", payload = JSONObject())
    }

    fun leave(topic: String) {
        if (joinedTopics.remove(topic)) {
            push(topic = topic, event = "phx_leave", payload = JSONObject())
        }
    }

    fun push(topic: String, event: String, payload: JSONObject) {
        val current = socket ?: return
        val ref = refCounter.getAndIncrement().toString()
        val joinRef = if (event == "phx_join") ref else JSONObject.NULL

        val frame = JSONArray()
            .put(joinRef)
            .put(ref)
            .put(topic)
            .put(event)
            .put(payload)

        current.send(frame.toString())
    }

    private fun openSocket() {
        val token = authToken ?: return
        val url = if (socketUrl.contains("?")) {
            "$socketUrl&token=$token&vsn=2.0.0"
        } else {
            "$socketUrl?token=$token&vsn=2.0.0"
        }

        socket = client.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    startHeartbeat()
                    joinedTopics.toList().forEach { topic ->
                        push(topic = topic, event = "phx_join", payload = JSONObject())
                    }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
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
                    scheduleReconnect()
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    socket = null
                    heartbeatJob?.cancel()
                    heartbeatJob = null
                    scheduleReconnect()
                }
            }
        )
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (true) {
                delay(25_000)
                push(topic = "phoenix", event = "heartbeat", payload = JSONObject())
            }
        }
    }

    private fun scheduleReconnect() {
        if (authToken.isNullOrBlank()) return
        if (reconnectJob?.isActive == true) return

        reconnectJob = scope.launch {
            delay(2_000)
            openSocket()
        }
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
