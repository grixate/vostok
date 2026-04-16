package chat.vostok.android.core.backup

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass
import com.squareup.moshi.Moshi
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * .vostok backup file encryption/decryption.
 * Format matches apps/web/src/lib/backup-crypto.ts and apps/ios/Vostok/Core/Backup/BackupCrypto.swift.
 *
 * File layout:
 *   Bytes 0-7:      Magic "VOSTOK01" (ASCII)
 *   Bytes 8-11:     Version uint32 BE (1)
 *   Bytes 12-15:    Salt length uint32 BE (N)
 *   Bytes 16..16+N: Salt (random, for PBKDF2)
 *   Rest:           12-byte AES-GCM nonce ‖ ciphertext ‖ 16-byte GCM tag
 *
 * Encryption: PBKDF2-SHA256 (600,000 iterations) → AES-256-GCM
 */

private const val MAGIC = "VOSTOK01"
private const val FORMAT_VERSION = 1
private const val SALT_BYTES = 32
private const val PBKDF2_ITERATIONS = 600_000
private const val IV_BYTES = 12
private const val TAG_BITS = 128
private const val KEY_BITS = 256

// MARK: – Types

enum class BackupCredentialMode {
    @Json(name = "addresses_only") ADDRESSES_ONLY,
    @Json(name = "quick_restore") QUICK_RESTORE,
    @Json(name = "full_credentials") FULL_CREDENTIALS,
}

@JsonClass(generateAdapter = true)
data class BackupPayload(
    val version: Int,
    @Json(name = "created_at") val createdAt: String,
    @Json(name = "expires_at") val expiresAt: String,
    @Json(name = "credential_mode") val credentialMode: BackupCredentialMode,
    val servers: List<BackupServerEntry>,
)

@JsonClass(generateAdapter = true)
data class BackupServerEntry(
    val url: String,
    val username: String,
    val label: String,
    val color: String,
    @Json(name = "sort_order") val sortOrder: Int,
    val credentials: BackupCredentials,
)

@JsonClass(generateAdapter = true)
data class BackupCredentials(
    @Json(name = "refresh_token") val refreshToken: String? = null,
    @Json(name = "refresh_token_expires_at") val refreshTokenExpiresAt: String? = null,
    val password: String? = null,
)

// MARK: – Errors

class BackupFormatException(message: String) : Exception(message)
class WrongPassphraseException : Exception("Wrong backup password")

// MARK: – Public API

fun validateBackupMagic(file: ByteArray): Boolean {
    if (file.size < 8) return false
    return String(file, 0, 8, Charsets.US_ASCII) == MAGIC
}

fun exportBackupFile(payload: BackupPayload, passphrase: String): ByteArray {
    val moshi = Moshi.Builder().build()
    val adapter = moshi.adapter(BackupPayload::class.java)
    val plaintext = adapter.toJson(payload).toByteArray(Charsets.UTF_8)

    // Generate salt
    val salt = ByteArray(SALT_BYTES)
    SecureRandom().nextBytes(salt)

    // Derive key
    val key = deriveKey(passphrase, salt)

    // Encrypt with AES-GCM
    val iv = ByteArray(IV_BYTES)
    SecureRandom().nextBytes(iv)

    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
    val encrypted = cipher.doFinal(plaintext) // ciphertext + tag appended by GCM

    // Build file: header + iv + encrypted (ciphertext+tag)
    val header = serializeHeader(salt)
    val result = ByteArray(header.size + IV_BYTES + encrypted.size)
    System.arraycopy(header, 0, result, 0, header.size)
    System.arraycopy(iv, 0, result, header.size, IV_BYTES)
    System.arraycopy(encrypted, 0, result, header.size + IV_BYTES, encrypted.size)

    return result
}

fun importBackupFile(fileBytes: ByteArray, passphrase: String): BackupPayload {
    val (salt, body) = parseHeader(fileBytes)

    val key = deriveKey(passphrase, salt)

    if (body.size < IV_BYTES + 16) {
        throw BackupFormatException("File truncated — encrypted data missing")
    }

    val iv = body.copyOfRange(0, IV_BYTES)
    val ciphertextAndTag = body.copyOfRange(IV_BYTES, body.size)

    val plaintext: ByteArray
    try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        plaintext = cipher.doFinal(ciphertextAndTag)
    } catch (_: Exception) {
        throw WrongPassphraseException()
    }

    val json = String(plaintext, Charsets.UTF_8)
    val moshi = Moshi.Builder().build()
    val adapter = moshi.adapter(BackupPayload::class.java)
    val payload = adapter.fromJson(json) ?: throw BackupFormatException("Invalid backup payload")

    if (payload.version != 1) {
        throw BackupFormatException("Unsupported backup version: ${payload.version}")
    }

    return payload
}

// MARK: – Private helpers

private fun deriveKey(passphrase: String, salt: ByteArray): SecretKeySpec {
    val spec = PBEKeySpec(passphrase.toCharArray(), salt, PBKDF2_ITERATIONS, KEY_BITS)
    val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
    val keyBytes = factory.generateSecret(spec).encoded
    return SecretKeySpec(keyBytes, "AES")
}

private fun serializeHeader(salt: ByteArray): ByteArray {
    val magicBytes = MAGIC.toByteArray(Charsets.US_ASCII) // 8 bytes
    val buf = ByteBuffer.allocate(8 + 4 + 4 + salt.size)
    buf.order(ByteOrder.BIG_ENDIAN)
    buf.put(magicBytes)
    buf.putInt(FORMAT_VERSION)
    buf.putInt(salt.size)
    buf.put(salt)
    return buf.array()
}

private fun parseHeader(file: ByteArray): Pair<ByteArray, ByteArray> {
    if (file.size < 16) throw BackupFormatException("File too small")

    val magic = String(file, 0, 8, Charsets.US_ASCII)
    if (magic != MAGIC) throw BackupFormatException("Not a valid Vostok backup file")

    val buf = ByteBuffer.wrap(file, 8, 8)
    buf.order(ByteOrder.BIG_ENDIAN)
    val version = buf.int
    val saltLength = buf.int

    if (version != FORMAT_VERSION) throw BackupFormatException("Unsupported version: $version")
    if (saltLength > 1024) throw BackupFormatException("Unreasonable salt length")
    if (file.size < 16 + saltLength) throw BackupFormatException("File truncated — salt missing")

    val salt = file.copyOfRange(16, 16 + saltLength)
    val body = file.copyOfRange(16 + saltLength, file.size)

    if (body.size < IV_BYTES + 16) throw BackupFormatException("Encrypted data missing")

    return salt to body
}
