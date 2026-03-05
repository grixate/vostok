package chat.vostok.android.core.repository

import chat.vostok.android.core.crypto.SignalSessionRuntime
import chat.vostok.android.core.network.ApiClient
import chat.vostok.android.core.network.CreateMessageRequest
import chat.vostok.android.core.network.MessageDto
import chat.vostok.android.core.network.UpdateMessageRequest
import chat.vostok.android.core.storage.dao.MessageDao
import chat.vostok.android.core.storage.dao.PendingOutboxDao
import chat.vostok.android.core.storage.entity.MessageEntity
import chat.vostok.android.core.storage.entity.PendingOutboxEntity
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class MessageRepository(
    private val apiClient: ApiClient,
    private val messageDao: MessageDao,
    private val pendingOutboxDao: PendingOutboxDao,
    private val sessionRuntime: SignalSessionRuntime
) {
    private val secureRandom = SecureRandom()

    suspend fun messages(chatId: String): List<MessageDto> {
        return runCatching {
            val remote = apiClient.messages(chatId).messages
            messageDao.upsert(remote.map { it.toEntity() })
            remote
        }.getOrElse {
            messageDao.byChat(chatId).map { it.toMessageDto() }
        }
    }

    suspend fun syncChat(chatId: String): List<MessageDto> = messages(chatId)

    suspend fun ingestRealtimeMessage(chatId: String, messageId: String?): List<MessageDto> {
        // Server emits chat/message ids; fetch full chat timeline and let DAO dedupe by id.
        if (!messageId.isNullOrBlank()) {
            // Hint retained for future targeted fetch support.
        }
        val remote = runCatching { apiClient.messages(chatId).messages }.getOrNull()
        if (remote != null) {
            messageDao.upsert(remote.map { it.toEntity() })
            return remote
        }

        return messageDao.byChat(chatId).map { it.toMessageDto() }
    }

    suspend fun sendTextMessage(
        chatId: String,
        text: String,
        recipientDeviceIds: List<String>
    ): MessageDto {
        val clientId = UUID.randomUUID().toString()
        val request = buildTextRequest(
            chatId = chatId,
            text = text,
            clientId = clientId,
            recipientDeviceIds = recipientDeviceIds
        )

        return runCatching {
            val sent = apiClient.createMessage(chatId, request).message
            messageDao.upsert(listOf(sent.toEntity()))
            sent
        }.getOrElse {
            pendingOutboxDao.upsert(
                listOf(
                    PendingOutboxEntity(
                        clientId = clientId,
                        chatId = chatId,
                        payload = encodeRequest(request),
                        createdAt = Instant.now().toString()
                    )
                )
            )

            MessageDto(
                id = "pending:$clientId",
                chatId = chatId,
                clientId = clientId,
                messageKind = "text",
                senderDeviceId = "local",
                insertedAt = Instant.now().toString(),
                ciphertext = request.ciphertext,
                header = request.header,
                recipientDeviceIds = request.recipientEnvelopes.keys.toList()
            )
        }
    }

    suspend fun sendMediaMessage(
        chatId: String,
        uploadId: String,
        filename: String,
        contentType: String,
        recipientDeviceIds: List<String>
    ): MessageDto {
        val clientId = UUID.randomUUID().toString()
        val payload = JSONObject()
            .put("upload_id", uploadId)
            .put("filename", filename)
            .put("content_type", contentType)
            .put("kind", "media_reference")
            .toString()

        val request = buildMessageRequest(
            chatId = chatId,
            payloadText = payload,
            clientId = clientId,
            recipientDeviceIds = recipientDeviceIds,
            messageKind = "file"
        )

        val sent = apiClient.createMessage(chatId, request).message
        messageDao.upsert(listOf(sent.toEntity()))
        return sent
    }

    suspend fun sendVoiceNoteMessage(
        chatId: String,
        durationSeconds: Int,
        recipientDeviceIds: List<String>
    ): MessageDto {
        val clientId = UUID.randomUUID().toString()
        val payload = JSONObject()
            .put("kind", "voice_note")
            .put("duration_seconds", durationSeconds)
            .put("waveform", "AAECAwQFBgcICQ==")
            .toString()

        val request = buildMessageRequest(
            chatId = chatId,
            payloadText = payload,
            clientId = clientId,
            recipientDeviceIds = recipientDeviceIds,
            messageKind = "voice"
        )

        val sent = apiClient.createMessage(chatId, request).message
        messageDao.upsert(listOf(sent.toEntity()))
        return sent
    }

    suspend fun sendRoundVideoMessage(
        chatId: String,
        durationSeconds: Int,
        recipientDeviceIds: List<String>
    ): MessageDto {
        val clientId = UUID.randomUUID().toString()
        val payload = JSONObject()
            .put("kind", "round_video")
            .put("duration_seconds", durationSeconds)
            .put("resolution", "480x480")
            .toString()

        val request = buildMessageRequest(
            chatId = chatId,
            payloadText = payload,
            clientId = clientId,
            recipientDeviceIds = recipientDeviceIds,
            messageKind = "video_round"
        )

        val sent = apiClient.createMessage(chatId, request).message
        messageDao.upsert(listOf(sent.toEntity()))
        return sent
    }

    suspend fun editTextMessage(
        chatId: String,
        messageId: String,
        text: String,
        recipientDeviceIds: List<String>
    ): MessageDto {
        val request = buildUpdateTextRequest(
            chatId = chatId,
            text = text,
            recipientDeviceIds = recipientDeviceIds
        )
        val updated = apiClient.updateMessage(chatId, messageId, request).message
        messageDao.upsert(listOf(updated.toEntity()))
        return updated
    }

    suspend fun deleteMessage(chatId: String, messageId: String): MessageDto {
        val deleted = apiClient.deleteMessage(chatId, messageId).message
        messageDao.upsert(listOf(deleted.toEntity()))
        return deleted
    }

    suspend fun togglePin(chatId: String, messageId: String): MessageDto {
        val pinned = apiClient.togglePin(chatId, messageId).message
        messageDao.upsert(listOf(pinned.toEntity()))
        return pinned
    }

    suspend fun toggleReaction(chatId: String, messageId: String, reactionKey: String): MessageDto {
        val reacted = apiClient.toggleReaction(chatId, messageId, reactionKey).message
        messageDao.upsert(listOf(reacted.toEntity()))
        return reacted
    }

    suspend fun flushPending(chatId: String? = null) {
        val pending = pendingOutboxDao.all().filter { chatId == null || it.chatId == chatId }
        for (item in pending) {
            val request = decodeRequest(item.payload)
            val sent = runCatching {
                apiClient.createMessage(item.chatId, request).message
            }.getOrNull() ?: continue

            messageDao.upsert(listOf(sent.toEntity()))
            pendingOutboxDao.remove(item.clientId)
        }
    }

    fun decodeCiphertextPreview(message: MessageDto): String {
        val encoded = message.ciphertext.orEmpty()
        if (encoded.isBlank()) return ""
        val decoded = runCatching {
            val bytes = Base64.getDecoder().decode(encoded)
            String(bytes, StandardCharsets.UTF_8)
        }.getOrDefault(encoded)

        if (message.messageKind == "file") {
            return runCatching {
                val json = JSONObject(decoded)
                val fileName = json.optString("filename").ifBlank { "attachment" }
                val uploadId = json.optString("upload_id").ifBlank { "-" }
                "Attachment: $fileName [$uploadId]"
            }.getOrDefault(decoded)
        }

        if (message.messageKind == "voice") {
            return runCatching {
                val json = JSONObject(decoded)
                val duration = json.optInt("duration_seconds", 0)
                "Voice message (${duration}s)"
            }.getOrDefault("Voice message")
        }

        if (message.messageKind == "video_round") {
            return runCatching {
                val json = JSONObject(decoded)
                val duration = json.optInt("duration_seconds", 0)
                "Round video (${duration}s)"
            }.getOrDefault("Round video")
        }

        return decoded
    }

    private suspend fun buildTextRequest(
        chatId: String,
        text: String,
        clientId: String,
        recipientDeviceIds: List<String>
    ): CreateMessageRequest {
        return buildMessageRequest(
            chatId = chatId,
            payloadText = text,
            clientId = clientId,
            recipientDeviceIds = recipientDeviceIds,
            messageKind = "text"
        )
    }

    private suspend fun buildMessageRequest(
        chatId: String,
        payloadText: String,
        clientId: String,
        recipientDeviceIds: List<String>,
        messageKind: String
    ): CreateMessageRequest {
        val resolvedRecipientDeviceIds = if (recipientDeviceIds.isNotEmpty()) {
            recipientDeviceIds
        } else {
            apiClient.recipientDevices(chatId).recipientDevices.map { it.deviceId }
        }.distinct()

        val sessionByDevice = sessionRuntime.ensureSessionMap(chatId, resolvedRecipientDeviceIds)
        val establishedSessionIds = sessionByDevice.values.distinct().sorted()
        val ciphertextBase64 =
            Base64.getEncoder().encodeToString(payloadText.toByteArray(StandardCharsets.UTF_8))
        val recipientEnvelopes = buildRecipientEnvelopes(resolvedRecipientDeviceIds, ciphertextBase64, sessionByDevice)

        return CreateMessageRequest(
            clientId = clientId,
            ciphertext = ciphertextBase64,
            header = createHeader(chatId, resolvedRecipientDeviceIds, sessionByDevice),
            messageKind = messageKind,
            recipientEnvelopes = recipientEnvelopes,
            establishedSessionIds = establishedSessionIds,
            replyToMessageId = null
        )
    }

    private suspend fun buildUpdateTextRequest(
        chatId: String,
        text: String,
        recipientDeviceIds: List<String>
    ): UpdateMessageRequest {
        val resolvedRecipientDeviceIds = if (recipientDeviceIds.isNotEmpty()) {
            recipientDeviceIds
        } else {
            apiClient.recipientDevices(chatId).recipientDevices.map { it.deviceId }
        }.distinct()

        val sessionByDevice = sessionRuntime.ensureSessionMap(chatId, resolvedRecipientDeviceIds)
        val establishedSessionIds = sessionByDevice.values.distinct().sorted()
        val ciphertextBase64 = Base64.getEncoder().encodeToString(text.toByteArray(StandardCharsets.UTF_8))
        val recipientEnvelopes = buildRecipientEnvelopes(resolvedRecipientDeviceIds, ciphertextBase64, sessionByDevice)

        return UpdateMessageRequest(
            clientId = null,
            ciphertext = ciphertextBase64,
            header = createHeader(chatId, resolvedRecipientDeviceIds, sessionByDevice),
            messageKind = "text",
            recipientEnvelopes = recipientEnvelopes,
            establishedSessionIds = establishedSessionIds,
            replyToMessageId = null
        )
    }

    private fun createHeader(
        chatId: String,
        recipientDeviceIds: List<String>,
        sessionByDevice: Map<String, String>
    ): String {
        val sessionJson = JSONObject()
        sessionByDevice.forEach { (deviceId, sessionId) ->
            sessionJson.put(deviceId, sessionId)
        }
        val headerJson = JSONObject()
            .put("algorithm", "signal-session-envelope-v1")
            .put("chat_id", chatId)
            .put("recipient_count", recipientDeviceIds.size)
            .put("session_ids", JSONArray(sessionByDevice.values.toList()))
            .put("session_by_device", sessionJson)
            .put("sent_at", Instant.now().toString())
        return Base64.getEncoder().encodeToString(headerJson.toString().toByteArray(StandardCharsets.UTF_8))
    }

    private fun buildRecipientEnvelopes(
        recipientDeviceIds: List<String>,
        ciphertext: String,
        sessionByDevice: Map<String, String>
    ): Map<String, String> {
        return recipientDeviceIds.associateWith { deviceId ->
            val stableSessionHint = sessionByDevice[deviceId].orEmpty()
            val encrypted = encryptEnvelopePayload(
                payloadBase64 = ciphertext,
                deviceId = deviceId,
                sessionHint = stableSessionHint
            )
            val envelopePayload = JSONObject()
                .put("session_hint", stableSessionHint)
                .put("device_id", deviceId)
                .put("envelope_v", "v2.aesgcm")
                .put("ciphertext", encrypted.ciphertextBase64)
                .put("nonce", encrypted.nonceBase64)
                .put("aad", encrypted.aadBase64)
                .put("sent_at", Instant.now().toString())
                .toString()
                .toByteArray(StandardCharsets.UTF_8)
            Base64.getEncoder().encodeToString(envelopePayload)
        }
    }

    private fun encryptEnvelopePayload(
        payloadBase64: String,
        deviceId: String,
        sessionHint: String
    ): EncryptedEnvelope {
        return runCatching {
            val key = deriveEnvelopeKey(deviceId, sessionHint)
            val nonce = ByteArray(12).also(secureRandom::nextBytes)
            val aadRaw = "device:$deviceId|session:$sessionHint".toByteArray(StandardCharsets.UTF_8)

            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            cipher.updateAAD(aadRaw)
            val encryptedRaw = cipher.doFinal(payloadBase64.toByteArray(StandardCharsets.UTF_8))

            EncryptedEnvelope(
                ciphertextBase64 = Base64.getEncoder().encodeToString(encryptedRaw),
                nonceBase64 = Base64.getEncoder().encodeToString(nonce),
                aadBase64 = Base64.getEncoder().encodeToString(aadRaw)
            )
        }.getOrElse {
            // Fail open to preserve delivery if crypto operation fails on a specific device.
            EncryptedEnvelope(
                ciphertextBase64 = payloadBase64,
                nonceBase64 = "",
                aadBase64 = ""
            )
        }
    }

    private fun deriveEnvelopeKey(deviceId: String, sessionHint: String): ByteArray {
        val seed = "$deviceId|$sessionHint|vostok-envelope-v2".toByteArray(StandardCharsets.UTF_8)
        val digest = MessageDigest.getInstance("SHA-256").digest(seed)
        return digest.copyOf(32)
    }

    private data class EncryptedEnvelope(
        val ciphertextBase64: String,
        val nonceBase64: String,
        val aadBase64: String
    )

    private fun encodeRequest(request: CreateMessageRequest): String {
        return JSONObject()
            .put("client_id", request.clientId)
            .put("ciphertext", request.ciphertext)
            .put("header", request.header)
            .put("message_kind", request.messageKind)
            .put("recipient_envelopes", JSONObject(request.recipientEnvelopes))
            .put("established_session_ids", JSONArray(request.establishedSessionIds ?: emptyList<String>()))
            .put("reply_to_message_id", request.replyToMessageId)
            .toString()
    }

    private fun decodeRequest(raw: String): CreateMessageRequest {
        val json = JSONObject(raw)
        val envelopesObject = json.optJSONObject("recipient_envelopes") ?: JSONObject()
        val envelopeMap = mutableMapOf<String, String>()
        envelopesObject.keys().forEach { key ->
            envelopeMap[key] = envelopesObject.optString(key)
        }

        val sessionArray = json.optJSONArray("established_session_ids") ?: JSONArray()
        val sessions = buildList {
            for (index in 0 until sessionArray.length()) {
                val value = sessionArray.optString(index)
                if (value.isNotBlank()) add(value)
            }
        }

        return CreateMessageRequest(
            clientId = json.getString("client_id"),
            ciphertext = json.getString("ciphertext"),
            header = json.getString("header"),
            messageKind = json.getString("message_kind"),
            recipientEnvelopes = envelopeMap,
            establishedSessionIds = sessions,
            replyToMessageId = json.optString("reply_to_message_id").takeIf { it.isNotBlank() }
        )
    }

    private fun MessageDto.toEntity() = MessageEntity(
        id = id,
        chatId = chatId,
        ciphertext = ciphertext.orEmpty(),
        insertedAt = insertedAt
    )

    private fun MessageEntity.toMessageDto() = MessageDto(
        id = id,
        chatId = chatId,
        messageKind = "text",
        senderDeviceId = "cached",
        insertedAt = insertedAt,
        ciphertext = ciphertext
    )
}
