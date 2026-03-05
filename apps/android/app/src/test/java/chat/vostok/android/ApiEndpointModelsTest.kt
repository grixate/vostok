package chat.vostok.android

import chat.vostok.android.core.network.BootstrapResponse
import chat.vostok.android.core.network.HealthResponse
import org.junit.Assert.assertEquals
import org.junit.Test

class ApiEndpointModelsTest {
    @Test
    fun healthModelHoldsStatus() {
        val response = HealthResponse(status = "ok")
        assertEquals("ok", response.status)
    }

    @Test
    fun bootstrapModelDefaultsVersion() {
        val response = BootstrapResponse(status = "ok")
        assertEquals("ok", response.status)
    }
}
