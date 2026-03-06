package chat.vostok.android.core.storage

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyInfo
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyStore
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory

data class SecureStorageStatus(
    val encryptedAtRest: Boolean,
    val requestedStrongBox: Boolean,
    val hardwareBacked: Boolean?
) {
    fun summary(): String {
        val hardwareValue = when (hardwareBacked) {
            true -> "hardware-backed"
            false -> "software-backed"
            null -> "unknown"
        }
        return "Encrypted at rest: $encryptedAtRest, StrongBox requested: $requestedStrongBox, key storage: $hardwareValue"
    }
}

object SecurePreferencesFactory {
    fun create(context: Context, name: String): SharedPreferences {
        return runCatching {
            val masterKey = buildMasterKey(context)

            EncryptedSharedPreferences.create(
                context,
                name,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        }.getOrElse { error ->
            throw IllegalStateException("Encrypted preferences unavailable for $name", error)
        }
    }

    fun currentStatus(context: Context): SecureStorageStatus {
        runCatching { buildMasterKey(context) }.getOrNull() ?: return SecureStorageStatus(
                encryptedAtRest = false,
                requestedStrongBox = supportsStrongBoxRequest(),
                hardwareBacked = null
            )

        val hardwareBacked = runCatching {
            val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val key = keyStore.getKey(MasterKey.DEFAULT_MASTER_KEY_ALIAS, null) as? SecretKey
                ?: return@runCatching null
            val factory = SecretKeyFactory.getInstance(key.algorithm, "AndroidKeyStore")
            val keyInfo = factory.getKeySpec(key, KeyInfo::class.java) as KeyInfo
            @Suppress("DEPRECATION")
            keyInfo.isInsideSecureHardware
        }.getOrNull()

        return SecureStorageStatus(
            encryptedAtRest = true,
            requestedStrongBox = supportsStrongBoxRequest(),
            hardwareBacked = hardwareBacked
        )
    }

    private fun buildMasterKey(context: Context): MasterKey {
        val strongBoxRequested = supportsStrongBoxRequest()
        if (!strongBoxRequested) {
            return MasterKey.Builder(context, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
        }

        return runCatching {
            MasterKey.Builder(context, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .setRequestStrongBoxBacked(true)
                .build()
        }.getOrElse {
            MasterKey.Builder(context, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
        }
    }

    private fun supportsStrongBoxRequest(): Boolean {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
    }
}
