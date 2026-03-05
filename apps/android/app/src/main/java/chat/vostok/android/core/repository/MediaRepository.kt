package chat.vostok.android.core.repository

import chat.vostok.android.core.network.ApiClient
import chat.vostok.android.core.network.LinkMetadataDto
import chat.vostok.android.core.network.MediaUploadDto
import chat.vostok.android.core.storage.MediaCache
import java.io.File
import java.security.MessageDigest
import java.util.Base64
import kotlin.math.ceil

class MediaRepository(
    private val apiClient: ApiClient,
    private val mediaCache: MediaCache
) {
    suspend fun uploadBytes(
        filename: String,
        contentType: String,
        payload: ByteArray,
        mediaKind: String = "file",
        partSizeBytes: Int = 64 * 1024
    ): MediaUploadDto {
        require(payload.isNotEmpty()) { "payload is empty" }

        val partCount = ceil(payload.size.toDouble() / partSizeBytes.toDouble()).toInt().coerceAtLeast(1)

        var upload = apiClient.createMediaUpload(
            mediaKind = mediaKind,
            filename = filename,
            contentType = contentType,
            declaredByteSize = payload.size,
            expectedPartCount = partCount
        ).upload

        for (partIndex in 0 until partCount) {
            val start = partIndex * partSizeBytes
            val end = minOf(start + partSizeBytes, payload.size)
            val chunk = payload.copyOfRange(start, end)
            val chunkBase64 = Base64.getEncoder().encodeToString(chunk)

            upload = apiClient.uploadMediaPart(
                uploadId = upload.id,
                chunkBase64 = chunkBase64,
                partIndex = partIndex,
                partCount = partCount
            ).upload
        }

        val digest = sha256Hex(payload)
        upload = apiClient.completeMediaUpload(upload.id, digest).upload
        return apiClient.mediaById(upload.id).upload.also { cacheCiphertext(it) }
    }

    suspend fun fetchUpload(uploadId: String): MediaUploadDto {
        val upload = apiClient.mediaById(uploadId).upload
        cacheCiphertext(upload)
        return upload
    }

    suspend fun pollUpload(uploadId: String): MediaUploadDto {
        return apiClient.mediaUploadStatus(uploadId).upload
    }

    suspend fun linkMetadata(url: String): LinkMetadataDto {
        return apiClient.linkMetadata(url).metadata
    }

    fun cachedUploadFile(uploadId: String): File = mediaCache.file("$uploadId.bin")

    private fun cacheCiphertext(upload: MediaUploadDto) {
        val ciphertextBase64 = upload.ciphertext ?: return
        val decoded = runCatching { Base64.getDecoder().decode(ciphertextBase64) }.getOrNull() ?: return
        val file = cachedUploadFile(upload.id)
        file.parentFile?.mkdirs()
        file.writeBytes(decoded)
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { "%02x".format(it) }
    }
}
