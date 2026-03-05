package chat.vostok.android.core.crypto

import android.content.Context
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.security.SecureRandom
import java.util.Base64

class KeyManager(context: Context) {
    private val prefs = context.getSharedPreferences("vostok_crypto_keys", Context.MODE_PRIVATE)
    private val random = SecureRandom()

    fun ensureIdentity(): String {
        val existingPublic = prefs.getString(PUB_KEY_PREF, null)
        val existingPrivate = prefs.getString(PRIV_KEY_PREF, null)
        if (!existingPublic.isNullOrBlank() && !existingPrivate.isNullOrBlank()) {
            return existingPublic
        }

        val privateKey = Ed25519PrivateKeyParameters(random)
        val publicKey = privateKey.generatePublicKey().encoded

        prefs.edit()
            .putString(PRIV_KEY_PREF, Base64.getEncoder().encodeToString(privateKey.encoded))
            .putString(PUB_KEY_PREF, Base64.getEncoder().encodeToString(publicKey))
            .apply()

        return Base64.getEncoder().encodeToString(publicKey)
    }

    fun publicKeyBase64(): String = ensureIdentity()

    fun signBase64(payload: ByteArray): String {
        val privateKey = loadPrivateKey()
        val signer = Ed25519Signer()
        signer.init(true, privateKey)
        signer.update(payload, 0, payload.size)
        val signature = signer.generateSignature()
        return Base64.getEncoder().encodeToString(signature)
    }

    fun signedPrekeyMaterial(): Pair<String, String> {
        val signedPrekey = ByteArray(32).also(random::nextBytes)
        val prekeyBase64 = Base64.getEncoder().encodeToString(signedPrekey)
        val signatureBase64 = signBase64(signedPrekey)
        return prekeyBase64 to signatureBase64
    }

    fun oneTimePrekeys(count: Int = 100): List<String> {
        return (0 until count).map {
            val bytes = ByteArray(32)
            random.nextBytes(bytes)
            Base64.getEncoder().encodeToString(bytes)
        }
    }

    private fun loadPrivateKey(): Ed25519PrivateKeyParameters {
        ensureIdentity()
        val privateBase64 = prefs.getString(PRIV_KEY_PREF, null)
            ?: error("Identity private key missing")
        val privateRaw = Base64.getDecoder().decode(privateBase64)
        return Ed25519PrivateKeyParameters(privateRaw, 0)
    }

    private companion object {
        const val PUB_KEY_PREF = "identity_public_key"
        const val PRIV_KEY_PREF = "identity_private_key"
    }
}
