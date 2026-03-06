package chat.vostok.android.core.crypto

import chat.vostok.android.core.network.ApiClient
import chat.vostok.android.core.network.ChatSessionDto
import chat.vostok.android.core.storage.SessionStore
import chat.vostok.android.core.storage.dao.SignalSessionDao
import chat.vostok.android.core.storage.entity.SignalSessionEntity
import org.json.JSONObject
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.SessionCipher
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.ecc.Curve
import org.signal.libsignal.protocol.ecc.ECKeyPair
import org.signal.libsignal.protocol.ecc.ECPublicKey
import org.signal.libsignal.protocol.message.CiphertextMessage
import org.signal.libsignal.protocol.message.PreKeySignalMessage
import org.signal.libsignal.protocol.message.SignalMessage
import org.signal.libsignal.protocol.state.SessionRecord
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.Base64

data class SignalEnvelopeCiphertext(
    val ciphertextBase64: String,
    val messageType: Int,
    val sessionId: String,
    val addressName: String,
    val addressDeviceId: Int
)

class SignalSessionRuntime(
    private val apiClient: ApiClient,
    private val signalSessionDao: SignalSessionDao,
    private val keyManager: KeyManager,
    private val sessionStore: SessionStore
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
            if (!existing?.sessionId.isNullOrBlank() && !existing?.sessionRecord.isNullOrBlank()) {
                established[peerDeviceId] = existing!!.sessionId
                continue
            }

            val refreshed = establishSession(chatId, peerDeviceId)
            if (refreshed?.sessionId?.isNotBlank() == true) {
                established[peerDeviceId] = refreshed.sessionId
            } else if (!existing?.sessionId.isNullOrBlank()) {
                established[peerDeviceId] = existing!!.sessionId
            }
        }

        return established.toMap()
    }

    suspend fun rekeySession(chatId: String, peerDeviceId: String): String? {
        return establishSession(chatId, peerDeviceId.trim())?.sessionId
    }

    suspend fun encryptRecipientEnvelope(
        chatId: String,
        peerDeviceId: String,
        plaintext: ByteArray
    ): SignalEnvelopeCiphertext? {
        val normalizedPeer = peerDeviceId.trim()
        if (normalizedPeer.isEmpty()) return null

        val entity = ensureSessionRecord(chatId, normalizedPeer) ?: return null
        val serializedRecord = entity.sessionRecord ?: return null

        val address = SignalProtocolAddress(entity.signalAddressName, entity.signalAddressDeviceId)
        val store = buildInMemoryStore()
        val sessionRecord = runCatching { SessionRecord(Base64.getDecoder().decode(serializedRecord)) }.getOrNull()
            ?: return null
        store.storeSession(address, sessionRecord)

        val encrypted = runCatching {
            SessionCipher(store, address).encrypt(plaintext)
        }.getOrNull() ?: return null

        val updatedRecord = runCatching {
            Base64.getEncoder().encodeToString(store.loadSession(address).serialize())
        }.getOrNull() ?: return null

        signalSessionDao.upsert(
            entity.copy(
                sessionRecord = updatedRecord,
                updatedAt = Instant.now().toString()
            )
        )

        return SignalEnvelopeCiphertext(
            ciphertextBase64 = Base64.getEncoder().encodeToString(encrypted.serialize()),
            messageType = encrypted.type,
            sessionId = entity.sessionId,
            addressName = entity.signalAddressName,
            addressDeviceId = entity.signalAddressDeviceId
        )
    }

    suspend fun decryptRecipientEnvelope(
        chatId: String,
        peerDeviceId: String,
        recipientEnvelopeBase64: String?
    ): ByteArray? {
        if (recipientEnvelopeBase64.isNullOrBlank()) return null
        val payloadJson = runCatching {
            val decoded = Base64.getDecoder().decode(recipientEnvelopeBase64)
            JSONObject(String(decoded, StandardCharsets.UTF_8))
        }.getOrNull() ?: return null

        if (payloadJson.optString("envelope_v") != "v3.libsignal") return null

        val messageType = payloadJson.optInt("cipher_type", -1)
        val ciphertextBase64 = payloadJson.optString("ciphertext")
        if (ciphertextBase64.isBlank()) return null

        val entity = ensureSessionRecord(chatId, peerDeviceId.trim()) ?: return null
        val serializedRecord = entity.sessionRecord ?: return null

        val address = SignalProtocolAddress(entity.signalAddressName, entity.signalAddressDeviceId)
        val store = buildInMemoryStore()
        val sessionRecord = runCatching { SessionRecord(Base64.getDecoder().decode(serializedRecord)) }.getOrNull()
            ?: return null
        store.storeSession(address, sessionRecord)

        val ciphertextRaw = runCatching { Base64.getDecoder().decode(ciphertextBase64) }.getOrNull()
            ?: return null
        val cipher = SessionCipher(store, address)

        val plaintext = runCatching {
            when (messageType) {
                CiphertextMessage.PREKEY_TYPE -> cipher.decrypt(PreKeySignalMessage(ciphertextRaw))
                CiphertextMessage.WHISPER_TYPE -> cipher.decrypt(SignalMessage(ciphertextRaw))
                else -> decryptWithBestEffort(cipher, ciphertextRaw)
            }
        }.getOrNull() ?: return null

        val updatedRecord = runCatching {
            Base64.getEncoder().encodeToString(store.loadSession(address).serialize())
        }.getOrNull() ?: return null

        signalSessionDao.upsert(
            entity.copy(
                sessionRecord = updatedRecord,
                updatedAt = Instant.now().toString()
            )
        )

        return plaintext
    }

    private fun decryptWithBestEffort(cipher: SessionCipher, ciphertext: ByteArray): ByteArray {
        return runCatching { cipher.decrypt(SignalMessage(ciphertext)) }
            .getOrElse { cipher.decrypt(PreKeySignalMessage(ciphertext)) }
    }

    private suspend fun ensureSessionRecord(chatId: String, peerDeviceId: String): SignalSessionEntity? {
        val current = signalSessionDao.byPeer(chatId, peerDeviceId)
        if (current != null &&
            current.signalAddressName.isNotBlank() &&
            current.signalAddressDeviceId > 0 &&
            !current.sessionRecord.isNullOrBlank()
        ) {
            return current
        }

        ensureSessionMap(chatId, listOf(peerDeviceId))
        return signalSessionDao.byPeer(chatId, peerDeviceId)
    }

    private suspend fun establishSession(chatId: String, peerDeviceId: String): SignalSessionEntity? {
        if (peerDeviceId.isBlank()) return null
        val localDeviceId = sessionStore.load()?.deviceId ?: return null

        val ephemeral = Curve.generateKeyPair()
        val ephemeralPublicBase64 = Base64.getEncoder().encodeToString(ephemeral.publicKey.serialize())

        val response = runCatching {
            apiClient.sessionRekey(
                chatId = chatId,
                initiatorEphemeralKeys = mapOf(peerDeviceId to ephemeralPublicBase64),
                peerDeviceId = peerDeviceId
            )
        }.getOrNull() ?: return signalSessionDao.byPeer(chatId, peerDeviceId)

        processSessionPayload(
            chatId = chatId,
            localDeviceId = localDeviceId,
            sessions = response.sessions,
            localEphemeralByRecipient = mapOf(peerDeviceId to ephemeral)
        )

        return signalSessionDao.byPeer(chatId, peerDeviceId)
    }

    private suspend fun processSessionPayload(
        chatId: String,
        localDeviceId: String,
        sessions: List<ChatSessionDto>,
        localEphemeralByRecipient: Map<String, ECKeyPair>
    ) {
        for (session in sessions) {
            if (session.chatId != chatId || session.sessionState == "superseded") continue

            if (session.initiatorDeviceId == localDeviceId) {
                val peer = session.recipientDeviceId
                val ephemeral = localEphemeralByRecipient[peer]
                val serialized = ephemeral?.let { buildAliceSessionRecord(session, it) }
                upsertSessionEntity(
                    chatId = chatId,
                    peerDeviceId = peer,
                    sessionId = session.id,
                    status = session.status,
                    serializedRecordBase64 = serialized
                )
                continue
            }

            if (session.recipientDeviceId == localDeviceId) {
                val peer = session.initiatorDeviceId
                val serialized = buildBobSessionRecord(session)
                upsertSessionEntity(
                    chatId = chatId,
                    peerDeviceId = peer,
                    sessionId = session.id,
                    status = session.status,
                    serializedRecordBase64 = serialized
                )
            }
        }
    }

    private suspend fun upsertSessionEntity(
        chatId: String,
        peerDeviceId: String,
        sessionId: String,
        status: String,
        serializedRecordBase64: String?
    ) {
        val existing = signalSessionDao.byPeer(chatId, peerDeviceId)
        val addressName = existing?.signalAddressName?.takeIf { it.isNotBlank() } ?: peerDeviceId
        val addressDeviceId = existing?.signalAddressDeviceId?.takeIf { it > 0 }
            ?: keyManager.stableSignalAddressDeviceId(peerDeviceId)

        signalSessionDao.upsert(
            SignalSessionEntity(
                chatId = chatId,
                peerDeviceId = peerDeviceId,
                sessionId = sessionId,
                status = status.ifBlank { "active" },
                signalAddressName = addressName,
                signalAddressDeviceId = addressDeviceId,
                sessionRecord = serializedRecordBase64 ?: existing?.sessionRecord,
                updatedAt = Instant.now().toString()
            )
        )
    }

    private fun buildAliceSessionRecord(session: ChatSessionDto, ephemeral: ECKeyPair): String? {
        val localIdentity = keyManager.signalIdentityKeyPair()
        val remoteIdentity = decodeIdentity(
            session.recipientEncryptionPublicKey,
            session.recipientIdentityPublicKey
        ) ?: return null
        val remoteSignedPreKey = decodePublicKey(session.recipientSignedPrekey) ?: return null
        val remoteOneTimePreKey = decodePublicKey(session.recipientOneTimePrekey) ?: remoteSignedPreKey

        val record = runCatching {
            SessionRecord.initializeAliceSession(
                localIdentity,
                ephemeral,
                remoteIdentity,
                remoteSignedPreKey,
                remoteOneTimePreKey
            )
        }.getOrNull() ?: return null

        return Base64.getEncoder().encodeToString(record.serialize())
    }

    private fun buildBobSessionRecord(session: ChatSessionDto): String? {
        val localIdentity = keyManager.signalIdentityKeyPair()
        val localSignedPreKey = keyManager.signalSignedPreKeyPair() ?: return null
        val localOneTimePreKey = session.recipientOneTimePrekey
            ?.let { keyManager.findSignalOneTimePreKeyPair(it) }
            ?: localSignedPreKey
        val remoteIdentity = decodeIdentity(
            session.initiatorEncryptionPublicKey,
            session.initiatorIdentityPublicKey
        ) ?: return null
        val remoteEphemeral = decodePublicKey(session.initiatorEphemeralPublicKey) ?: return null

        val record = runCatching {
            SessionRecord.initializeBobSession(
                localIdentity,
                localSignedPreKey,
                localOneTimePreKey,
                remoteIdentity,
                remoteEphemeral
            )
        }.getOrNull() ?: return null

        return Base64.getEncoder().encodeToString(record.serialize())
    }

    private fun decodeIdentity(primaryBase64: String?, fallbackBase64: String?): IdentityKey? {
        val candidates = listOf(primaryBase64, fallbackBase64).filter { !it.isNullOrBlank() }
        for (candidate in candidates) {
            val parsed = runCatching {
                IdentityKey(Base64.getDecoder().decode(candidate))
            }.getOrNull()
            if (parsed != null) return parsed
        }
        return null
    }

    private fun decodePublicKey(valueBase64: String?): ECPublicKey? {
        if (valueBase64.isNullOrBlank()) return null
        val raw = runCatching { Base64.getDecoder().decode(valueBase64) }.getOrNull() ?: return null
        return runCatching { ECPublicKey(raw) }.getOrNull()
    }

    private fun buildInMemoryStore(): InMemorySignalProtocolStore {
        return InMemorySignalProtocolStore(
            keyManager.signalIdentityKeyPair(),
            keyManager.signalRegistrationId()
        )
    }
}
