package chat.vostok.android.core.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WebSocketManagerBackoffTest {
    private val webSocketManager = WebSocketManager("ws://localhost/socket/websocket")

    @Test
    fun reconnectDelay_immediate_returnsZero() {
        val delay = webSocketManager.reconnectDelayMs(attempt = 1, immediate = true, jitterMs = 321)
        assertEquals(0L, delay)
    }

    @Test
    fun reconnectDelay_growsAndCapsAtOneMinutePlusJitter() {
        val delays = (1..8).map { attempt ->
            webSocketManager.reconnectDelayMs(attempt = attempt, immediate = false, jitterMs = 0)
        }

        assertTrue(delays.zipWithNext().all { (left, right) -> right >= left })
        assertEquals(60_000L, delays.last())
    }

    @Test
    fun reconnectDelay_clampsJitterRange() {
        val low = webSocketManager.reconnectDelayMs(attempt = 2, immediate = false, jitterMs = -50)
        val high = webSocketManager.reconnectDelayMs(attempt = 2, immediate = false, jitterMs = 5_000)

        assertEquals(4_000L, low)
        assertEquals(4_600L, high)
    }

    @Test
    fun dropDecision_paused_movesToPausedWithoutReconnect() {
        assertEquals(
            SocketConnectionState.PAUSED,
            webSocketManager.stateAfterSocketDrop(
                isPaused = true,
                networkAvailable = true,
                hasAuthToken = true
            )
        )
        assertEquals(
            false,
            webSocketManager.shouldScheduleReconnectAfterDrop(
                isPaused = true,
                networkAvailable = true,
                hasAuthToken = true
            )
        )
    }

    @Test
    fun dropDecision_networkLoss_staysDisconnectedWithoutReconnect() {
        assertEquals(
            SocketConnectionState.DISCONNECTED,
            webSocketManager.stateAfterSocketDrop(
                isPaused = false,
                networkAvailable = false,
                hasAuthToken = true
            )
        )
        assertEquals(
            false,
            webSocketManager.shouldScheduleReconnectAfterDrop(
                isPaused = false,
                networkAvailable = false,
                hasAuthToken = true
            )
        )
    }

    @Test
    fun dropDecision_authorizedForegroundReconnects() {
        assertEquals(
            SocketConnectionState.RECONNECTING,
            webSocketManager.stateAfterSocketDrop(
                isPaused = false,
                networkAvailable = true,
                hasAuthToken = true
            )
        )
        assertEquals(
            true,
            webSocketManager.shouldScheduleReconnectAfterDrop(
                isPaused = false,
                networkAvailable = true,
                hasAuthToken = true
            )
        )
    }
}
