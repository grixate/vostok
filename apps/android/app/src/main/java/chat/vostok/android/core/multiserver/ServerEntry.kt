package chat.vostok.android.core.multiserver

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass
import java.net.URI
import java.util.UUID

/**
 * A configured server connection, matching the web's ServerEntry type
 * from apps/web/src/lib/multi-server.ts and iOS ServerEntry.swift.
 */
@JsonClass(generateAdapter = true)
data class ServerEntry(
    val id: String,
    var label: String,
    var url: String,
    var color: String,
    var auth: ServerAuth? = null,
    var device: ServerDevice? = null,
    @Json(name = "server_info") var serverInfo: ServerInfoDto? = null,
    @Json(name = "last_connected_at") var lastConnectedAt: String? = null,
    @Json(name = "sort_order") var sortOrder: Int = 0,
    var enabled: Boolean = true,
) {
    companion object {
        fun create(url: String, label: String, color: String = "#FF5500"): ServerEntry {
            return ServerEntry(
                id = "srv_${UUID.randomUUID().toString().take(12)}",
                label = label,
                url = normalizeServerUrl(url),
                color = color,
            )
        }
    }
}

@JsonClass(generateAdapter = true)
data class ServerAuth(
    val token: String,
    @Json(name = "user_id") val userId: String,
    val username: String,
    @Json(name = "device_id") val deviceId: String,
)

@JsonClass(generateAdapter = true)
data class ServerDevice(
    @Json(name = "device_id") val deviceId: String,
    @Json(name = "identity_public_key") val identityPublicKey: String,
)

@JsonClass(generateAdapter = true)
data class ServerInfoDto(
    val name: String,
    val version: String,
    @Json(name = "auth_mode") val authMode: String? = null,
)

// MARK: – Server Connection Status

enum class ServerConnectionStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    OFFLINE,
    AUTH_REQUIRED,
    ERROR,
}

// MARK: – QualifiedChatId

typealias QualifiedChatId = String

fun qualifyChatId(serverId: String, chatId: String): QualifiedChatId = "$serverId::$chatId"

fun isQualifiedChatId(value: String?): Boolean = value?.contains("::") == true

fun parseQualifiedChatId(qualifiedId: String): Pair<String, String> {
    val idx = qualifiedId.indexOf("::")
    if (idx < 0) return "" to qualifiedId
    return qualifiedId.substring(0, idx) to qualifiedId.substring(idx + 2)
}

fun serverIdFrom(chatId: String?): String? {
    if (chatId == null || !isQualifiedChatId(chatId)) return null
    return parseQualifiedChatId(chatId).first.takeIf { it.isNotEmpty() }
}

fun rawChatId(chatId: String?): String? {
    if (chatId == null) return null
    if (!isQualifiedChatId(chatId)) return chatId
    return parseQualifiedChatId(chatId).second
}

// MARK: – URL helpers

fun normalizeServerUrl(url: String): String {
    val trimmed = url.trim()
    if (trimmed.isEmpty()) return ""

    val withScheme = if (!trimmed.contains("://")) "https://$trimmed" else trimmed

    return try {
        val uri = URI(withScheme)
        val host = uri.host
        if (host.isNullOrEmpty()) return ""
        val path = uri.path?.trimEnd('/') ?: ""
        val port = if (uri.port > 0 && uri.port != 443 && uri.port != 80) ":${uri.port}" else ""
        "${uri.scheme}://$host$port$path"
    } catch (_: Exception) {
        trimmed.trimEnd('/')
    }
}

fun socketUrlFrom(baseUrl: String): String? {
    val normalized = normalizeServerUrl(baseUrl)
    if (normalized.isEmpty()) return null
    return try {
        val uri = URI(normalized)
        val scheme = if (uri.scheme == "https") "wss" else "ws"
        val host = uri.host ?: return null
        val port = if (uri.port > 0 && uri.port != 443 && uri.port != 80) ":${uri.port}" else ""
        "$scheme://$host$port/socket/device/websocket"
    } catch (_: Exception) {
        null
    }
}
