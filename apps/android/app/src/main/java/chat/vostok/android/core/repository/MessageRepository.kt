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
import java.time.Instant
import java.util.Base64
import java.util.UUID

class MessageRepository(
    private val apiClient: ApiClient,
    private val messageDao: MessageDao,
    private val pendingOutboxDao: PendingOutboxDao,
    private val sessionRuntime: SignalSessionRuntime
) {
    private val decryptedCiphertextByMessageId = linkedMapOf<String, String>()

    suspend fun messages(chatId: String): List<MessageDto> {
        return runCatching {
            val remote = apiClient.messages(chatId).messages.map { decryptMessageIfNeeded(chatId, it) }
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
        val remote = runCatching {
            apiClient.messages(chatId).messages.map { decryptMessageIfNeeded(chatId, it) }
        }.getOrNull()
        if (remote != null) {
            messageDao.upsert(remote.map { it.toEntity() })
            return remote
        }

        return messageDao.byChat(chatId).map { it.toMessageDto() }
    }

    suspend fun markChatRead(chatId: String, lastReadMessageId: String? = null) {
        apiClient.markChatRead(chatId = chatId, lastReadMessageId = lastReadMessageId)
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
        return sendMediaReferenceMessage(
            chatId = chatId,
            uploadId = uploadId,
            filename = filename,
            contentType = contentType,
            kind = "media_reference",
            messageKind = "media",
            recipientDeviceIds = recipientDeviceIds,
            extras = null
        )
    }

    suspend fun sendVoiceNoteMessage(
        chatId: String,
        durationSeconds: Int,
        recipientDeviceIds: List<String>
    ): MessageDto {
        return sendMediaReferenceMessage(
            chatId = chatId,
            uploadId = "",
            filename = "voice-note.m4a",
            contentType = "audio/mp4",
            kind = "voice_note",
            messageKind = "media",
            recipientDeviceIds = recipientDeviceIds,
            extras = JSONObject()
                .put("duration_seconds", durationSeconds)
                .put("waveform", "AAECAwQFBgcICQ==")
        )
    }

    suspend fun sendRoundVideoMessage(
        chatId: String,
        durationSeconds: Int,
        recipientDeviceIds: List<String>
    ): MessageDto {
        return sendMediaReferenceMessage(
            chatId = chatId,
            uploadId = "",
            filename = "round-video.mp4",
            contentType = "video/mp4",
            kind = "round_video",
            messageKind = "media",
            recipientDeviceIds = recipientDeviceIds,
            extras = JSONObject()
                .put("duration_seconds", durationSeconds)
                .put("resolution", "480x480")
        )
    }

    suspend fun sendVoiceNoteUploadMessage(
        chatId: String,
        uploadId: String,
        filename: String,
        contentType: String,
        durationSeconds: Int,
        recipientDeviceIds: List<String>
    ): MessageDto {
        return sendMediaReferenceMessage(
            chatId = chatId,
            uploadId = uploadId,
            filename = filename,
            contentType = contentType,
            kind = "voice_note",
            messageKind = "media",
            recipientDeviceIds = recipientDeviceIds,
            extras = JSONObject()
                .put("duration_seconds", durationSeconds)
        )
    }

    suspend fun sendRoundVideoUploadMessage(
        chatId: String,
        uploadId: String,
        filename: String,
        contentType: String,
        durationSeconds: Int,
        recipientDeviceIds: List<String>
    ): MessageDto {
        return sendMediaReferenceMessage(
            chatId = chatId,
            uploadId = uploadId,
            filename = filename,
            contentType = contentType,
            kind = "round_video",
            messageKind = "media",
            recipientDeviceIds = recipientDeviceIds,
            extras = JSONObject()
                .put("duration_seconds", durationSeconds)
                .put("resolution", "480x480")
        )
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

        return runCatching {
            val json = JSONObject(decoded)
            when (json.optString("kind")) {
                "media_reference" -> {
                    val fileName = json.optString("filename").ifBlank { "attachment" }
                    val uploadId = json.optString("upload_id").ifBlank { "-" }
                    "Attachment: $fileName [$uploadId]"
                }

                "voice_note" -> {
                    val duration = json.optInt("duration_seconds", 0)
                    val uploadId = json.optString("upload_id").takeIf { it.isNotBlank() }
                    if (uploadId != null) "Voice message (${duration}s) [$uploadId]"
                    else "Voice message (${duration}s)"
                }

                "round_video" -> {
                    val duration = json.optInt("duration_seconds", 0)
                    val uploadId = json.optString("upload_id").takeIf { it.isNotBlank() }
                    if (uploadId != null) "Round video (${duration}s) [$uploadId]"
                    else "Round video (${duration}s)"
                }

                else -> decoded
            }
        }.getOrDefault(decoded)
    }

    private suspend fun sendMediaReferenceMessage(
        chatId: String,
        uploadId: String,
        filename: String,
        contentType: String,
        kind: String,
        messageKind: String,
        recipientDeviceIds: List<String>,
        extras: JSONObject?
    ): MessageDto {
        val clientId = UUID.randomUUID().toString()
        val payload = JSONObject()
            .put("upload_id", uploadId)
            .put("filename", filename)
            .put("content_type", contentType)
            .put("kind", kind)

        extras?.keys()?.forEach { key ->
            payload.put(key, extras.opt(key))
        }

        val request = buildMessageRequest(
            chatId = chatId,
            payloadText = payload.toString(),
            clientId = clientId,
            recipientDeviceIds = recipientDeviceIds,
            messageKind = messageKind
        )

        val sent = apiClient.createMessage(chatId, request).message
        val normalized = decryptMessageIfNeeded(chatId, sent)
        messageDao.upsert(listOf(normalized.toEntity()))
        return normalized
    }

    private suspend fun decryptMessageIfNeeded(chatId: String, message: MessageDto): MessageDto {
        if (!message.recipientEnvelope.isNullOrBlank()) {
            val cached = decryptedCiphertextByMessageId[message.id]
            if (!cached.isNullOrBlank()) {
                return message.copy(ciphertext = cached)
            }

            val decrypted = sessionRuntime.decryptRecipientEnvelope(
                chatId = chatId,
                peerDeviceId = message.senderDeviceId,
                recipientEnvelopeBase64 = message.recipientEnvelope
            )
            if (decrypted != null) {
                val encoded = Base64.getEncoder().encodeToString(decrypted)
                decryptedCiphertextByMessageId[message.id] = encoded
                return message.copy(ciphertext = encoded)
            }
        }

        return message
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
        val recipientEnvelopes = buildRecipientEnvelopes(
            chatId = chatId,
            payloadPlaintext = payloadText.toByteArray(StandardCharsets.UTF_8),
            recipientDeviceIds = resolvedRecipientDeviceIds,
            sessionByDevice = sessionByDevice
        )

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
        val recipientEnvelopes = buildRecipientEnvelopes(
            chatId = chatId,
            payloadPlaintext = text.toByteArray(StandardCharsets.UTF_8),
            recipientDeviceIds = resolvedRecipientDeviceIds,
            sessionByDevice = sessionByDevice
        )

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
            .put("algorithm", "signal-session-envelope-v3")
            .put("chat_id", chatId)
            .put("recipient_count", recipientDeviceIds.size)
            .put("session_ids", JSONArray(sessionByDevice.values.toList()))
            .put("session_by_device", sessionJson)
            .put("sent_at", Instant.now().toString())
        return Base64.getEncoder().encodeToString(headerJson.toString().toByteArray(StandardCharsets.UTF_8))
    }

    private suspend fun buildRecipientEnvelopes(
        chatId: String,
        payloadPlaintext: ByteArray,
        recipientDeviceIds: List<String>,
        sessionByDevice: Map<String, String>
    ): Map<String, String> {
        val envelopes = linkedMapOf<String, String>()

        for (deviceId in recipientDeviceIds) {
            val stableSessionHint = sessionByDevice[deviceId].orEmpty()
            val signalEnvelope = sessionRuntime.encryptRecipientEnvelope(
                chatId = chatId,
                peerDeviceId = deviceId,
                plaintext = payloadPlaintext
            ) ?: throw IllegalStateException("Missing libsignal session for recipient device $deviceId")

            val envelopePayload = JSONObject()
                .put("session_hint", signalEnvelope.sessionId.ifBlank { stableSessionHint })
                .put("device_id", deviceId)
                .put("envelope_v", "v3.libsignal")
                .put("cipher_type", signalEnvelope.messageType)
                .put("ciphertext", signalEnvelope.ciphertextBase64)
                .put("address_name", signalEnvelope.addressName)
                .put("address_device_id", signalEnvelope.addressDeviceId)
                .put("sent_at", Instant.now().toString())

            envelopes[deviceId] = Base64.getEncoder()
                .encodeToString(envelopePayload.toString().toByteArray(StandardCharsets.UTF_8))
        }
        return envelopes.toMap()
    }

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
