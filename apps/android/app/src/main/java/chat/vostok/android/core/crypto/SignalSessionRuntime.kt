package chat.vostok.android.core.crypto

import chat.vostok.android.core.network.ApiClient
import chat.vostok.android.core.storage.dao.SignalSessionDao
import chat.vostok.android.core.storage.entity.SignalSessionEntity
import java.time.Instant

class SignalSessionRuntime(
    private val apiClient: ApiClient,
    private val signalSessionDao: SignalSessionDao
) {
    suspend fun ensureSessions(chatId: String, peerDeviceIds: List<String>): List<String> {
        return ensureSessionMap(chatId, peerDeviceIds).values.distinct().sorted()
    }

    suspend fun ensureSessionMap(chatId: String, peerDeviceIds: List<String>): Map<String, String> {
        val normalized = peerDeviceIds.map { it.trim() }.filter { it.isNotEmpty() }.distinct().sorted()
        if (normalized.isEmpty()) return emptyMap()

        val established = linkedMapOf<String, String>()
        for (peerDeviceId in normalized) {
            val existing = signalSessionDao.byPeer(chatId, peerDeviceId)
            if (existing?.sessionId?.isNotBlank() == true) {
                established[peerDeviceId] = existing.sessionId
                continue
            }

            val bootstrap = runCatching {
                apiClient.sessionBootstrap(chatId = chatId, peerDeviceId = peerDeviceId)
            }.getOrNull()

            val matchedSession = bootstrap?.sessions?.firstOrNull {
                it.recipientDeviceId == peerDeviceId || it.initiatorDeviceId == peerDeviceId
            }

            if (matchedSession != null) {
                signalSessionDao.upsert(
                    SignalSessionEntity(
                        chatId = chatId,
                        peerDeviceId = peerDeviceId,
                        sessionId = matchedSession.id,
                        status = matchedSession.status,
                        updatedAt = Instant.now().toString()
                    )
                )
                established[peerDeviceId] = matchedSession.id
            }
        }

        return established.toMap()
    }

    suspend fun rekeySession(chatId: String, peerDeviceId: String): String? {
        val response = runCatching {
            apiClient.sessionRekey(chatId = chatId, peerDeviceId = peerDeviceId)
        }.getOrNull() ?: return null

        val matched = response.sessions.firstOrNull {
            it.recipientDeviceId == peerDeviceId || it.initiatorDeviceId == peerDeviceId
        } ?: return null

        signalSessionDao.upsert(
            SignalSessionEntity(
                chatId = chatId,
                peerDeviceId = peerDeviceId,
                sessionId = matched.id,
                status = matched.status,
                updatedAt = Instant.now().toString()
            )
        )
        return matched.id
    }
}
