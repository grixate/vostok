package chat.vostok.android.core.multiserver

import android.content.Context
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import chat.vostok.android.BuildConfig
import chat.vostok.android.core.storage.SessionStore
import java.io.File
import java.time.Instant

/**
 * Persists the server list to a JSON file in the app's internal storage.
 * Handles migration from legacy single-server auth (SessionStore + BuildConfig).
 */
class ServerStore(private val context: Context) {
    private val moshi = Moshi.Builder().build()
    private val listType = Types.newParameterizedType(List::class.java, ServerEntry::class.java)
    private val adapter = moshi.adapter<List<ServerEntry>>(listType).indent("  ")
    private val file: File get() = File(context.filesDir, FILE_NAME)
    private val lock = Any()

    fun load(): List<ServerEntry> = synchronized(lock) {
        try {
            if (!file.exists()) return emptyList()
            val json = file.readText()
            adapter.fromJson(json)?.sortedBy { it.sortOrder } ?: emptyList()
        } catch (e: Exception) {
            android.util.Log.w("ServerStore", "Failed to load servers: $e")
            emptyList()
        }
    }

    fun save(servers: List<ServerEntry>): Unit = synchronized(lock) {
        try {
            file.writeText(adapter.toJson(servers))
        } catch (e: Exception) {
            android.util.Log.e("ServerStore", "Failed to save servers: $e")
        }
    }

    fun add(entry: ServerEntry): List<ServerEntry> = synchronized(lock) {
        val servers = load().toMutableList()
        val withOrder = entry.copy(sortOrder = servers.size)
        servers.add(withOrder)
        save(servers)
        servers
    }

    fun update(entry: ServerEntry): List<ServerEntry> = synchronized(lock) {
        val servers = load().toMutableList()
        val idx = servers.indexOfFirst { it.id == entry.id }
        if (idx >= 0) servers[idx] = entry
        save(servers)
        servers
    }

    fun remove(id: String): List<ServerEntry> = synchronized(lock) {
        val servers = load().filter { it.id != id }
        val reordered = servers.mapIndexed { i, s -> s.copy(sortOrder = i) }
        save(reordered)
        reordered
    }

    /**
     * Migrates from single-server (SessionStore + BuildConfig) to multi-server.
     * Called once on first launch after the multi-server update.
     */
    fun migrateFromLegacySingleServer(sessionStore: SessionStore): List<ServerEntry> {
        val existing = load()
        if (existing.isNotEmpty()) return existing

        val legacySession = sessionStore.load() ?: return emptyList()

        val entry = ServerEntry.create(
            url = BuildConfig.VOSTOK_BASE_URL,
            label = BuildConfig.VOSTOK_INSTANCE_LABEL.ifBlank { "My Server" },
            color = "#FF5500",
        ).copy(
            auth = ServerAuth(
                token = legacySession.token,
                userId = legacySession.userId,
                username = legacySession.username ?: "",
                deviceId = legacySession.deviceId,
            ),
            device = ServerDevice(
                deviceId = legacySession.deviceId,
                identityPublicKey = "",
            ),
            lastConnectedAt = Instant.now().toString(),
        )

        val servers = listOf(entry)
        save(servers)
        return servers
    }

    companion object {
        private const val FILE_NAME = "vostok.servers.json"
    }
}
