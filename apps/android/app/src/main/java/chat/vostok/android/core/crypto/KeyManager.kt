package chat.vostok.android.core.crypto

import android.content.Context
import chat.vostok.android.core.storage.SecurePreferencesFactory
import org.json.JSONObject
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair
import org.signal.libsignal.protocol.ecc.Curve
import org.signal.libsignal.protocol.ecc.ECKeyPair
import org.signal.libsignal.protocol.ecc.ECPrivateKey
import org.signal.libsignal.protocol.ecc.ECPublicKey
import org.signal.libsignal.protocol.util.KeyHelper
import java.security.SecureRandom
import java.security.MessageDigest
import java.nio.ByteBuffer
import java.util.Base64

class KeyManager(context: Context) {
    private val prefs = SecurePreferencesFactory.create(context, "vostok_crypto_keys")
    private val signingKeyProvider: SigningKeyProvider = CompositeSigningKeyProvider(prefs)
    private val random = SecureRandom()

    fun ensureIdentity(): String {
        return signingKeyProvider.ensureIdentity()
    }

    fun publicKeyBase64(): String = ensureIdentity()

    fun signBase64(payload: ByteArray): String {
        return signingKeyProvider.signBase64(payload)
    }

    fun signingStorageSummary(): String = signingKeyProvider.summary()

    fun signingProviderKind(): SigningProviderKind = signingKeyProvider.kind

    fun signingIdentityIsNonExportable(): Boolean = signingKeyProvider.kind.nonExportable

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

    data class SignalPrekeyMaterial(
        val encryptionPublicKey: String,
        val signedPrekey: String,
        val signedPrekeySignature: String,
        val oneTimePrekeys: List<String>
    )

    fun prepareSignalPrekeyMaterial(oneTimeCount: Int = 100): SignalPrekeyMaterial {
        val identity = ensureSignalIdentity()
        val signedPrekeyPair = Curve.generateKeyPair()
        val signedPrekeyPublicBase64 =
            Base64.getEncoder().encodeToString(signedPrekeyPair.publicKey.serialize())
        val signedPrekeyPrivateBase64 =
            Base64.getEncoder().encodeToString(signedPrekeyPair.privateKey.serialize())

        val oneTimePairs = (0 until oneTimeCount).map {
            val pair = Curve.generateKeyPair()
            val publicBase64 = Base64.getEncoder().encodeToString(pair.publicKey.serialize())
            val privateBase64 = Base64.getEncoder().encodeToString(pair.privateKey.serialize())
            publicBase64 to privateBase64
        }

        val oneTimeMap = JSONObject()
        oneTimePairs.forEach { (publicBase64, privateBase64) ->
            oneTimeMap.put(publicBase64, privateBase64)
        }

        prefs.edit()
            .putString(SIGNAL_SIGNED_PREKEY_PUBLIC_PREF, signedPrekeyPublicBase64)
            .putString(SIGNAL_SIGNED_PREKEY_PRIVATE_PREF, signedPrekeyPrivateBase64)
            .putString(SIGNAL_ONE_TIME_PREKEYS_PREF, oneTimeMap.toString())
            .apply()

        return SignalPrekeyMaterial(
            encryptionPublicKey = identity.publicKeyBase64,
            signedPrekey = signedPrekeyPublicBase64,
            signedPrekeySignature = signBase64(Base64.getDecoder().decode(signedPrekeyPublicBase64)),
            oneTimePrekeys = oneTimePairs.map { it.first }
        )
    }

    fun signalIdentityKeyPair(): IdentityKeyPair = ensureSignalIdentity().identityKeyPair

    fun signalIdentityPublicKeyBase64(): String = ensureSignalIdentity().publicKeyBase64

    fun signalRegistrationId(): Int {
        val existing = prefs.getInt(SIGNAL_REGISTRATION_ID_PREF, 0)
        if (existing > 0) return existing

        val generated = KeyHelper.generateRegistrationId(false)
        prefs.edit().putInt(SIGNAL_REGISTRATION_ID_PREF, generated).apply()
        return generated
    }

    fun signalSignedPreKeyPair(): ECKeyPair? {
        val publicBase64 = prefs.getString(SIGNAL_SIGNED_PREKEY_PUBLIC_PREF, null) ?: return null
        val privateBase64 = prefs.getString(SIGNAL_SIGNED_PREKEY_PRIVATE_PREF, null) ?: return null
        return decodeEcKeyPair(publicBase64, privateBase64)
    }

    fun findSignalOneTimePreKeyPair(publicKeyBase64: String): ECKeyPair? {
        if (publicKeyBase64.isBlank()) return null
        val raw = prefs.getString(SIGNAL_ONE_TIME_PREKEYS_PREF, null) ?: return null
        val map = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val privateKeyBase64 = map.optString(publicKeyBase64).takeIf { it.isNotBlank() } ?: return null
        return decodeEcKeyPair(publicKeyBase64, privateKeyBase64)
    }

    fun stableSignalAddressDeviceId(deviceId: String): Int {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(deviceId.trim().toByteArray())
        val candidate = ByteBuffer.wrap(digest.copyOfRange(0, 4)).int and Int.MAX_VALUE
        return if (candidate == 0) 1 else candidate
    }

    private data class SignalIdentityMaterial(
        val identityKeyPair: IdentityKeyPair,
        val publicKeyBase64: String
    )

    private fun ensureSignalIdentity(): SignalIdentityMaterial {
        val existingPublic = prefs.getString(SIGNAL_IDENTITY_PUBLIC_PREF, null)
        val existingPrivate = prefs.getString(SIGNAL_IDENTITY_PRIVATE_PREF, null)
        if (!existingPublic.isNullOrBlank() && !existingPrivate.isNullOrBlank()) {
            val restored = decodeIdentity(existingPublic, existingPrivate)
            if (restored != null) return restored
        }

        val generatedPair = Curve.generateKeyPair()
        val generatedIdentity = IdentityKey(generatedPair.publicKey)
        val publicBase64 = Base64.getEncoder().encodeToString(generatedIdentity.serialize())
        val privateBase64 = Base64.getEncoder().encodeToString(generatedPair.privateKey.serialize())
        val registrationId = KeyHelper.generateRegistrationId(false)

        prefs.edit()
            .putString(SIGNAL_IDENTITY_PUBLIC_PREF, publicBase64)
            .putString(SIGNAL_IDENTITY_PRIVATE_PREF, privateBase64)
            .putInt(SIGNAL_REGISTRATION_ID_PREF, registrationId)
            .apply()

        return SignalIdentityMaterial(
            identityKeyPair = IdentityKeyPair(generatedIdentity, generatedPair.privateKey),
            publicKeyBase64 = publicBase64
        )
    }

    private fun decodeIdentity(
        publicKeyBase64: String,
        privateKeyBase64: String
    ): SignalIdentityMaterial? {
        return runCatching {
            val identityPublic = IdentityKey(Base64.getDecoder().decode(publicKeyBase64))
            val identityPrivate = ECPrivateKey(Base64.getDecoder().decode(privateKeyBase64))
            SignalIdentityMaterial(
                identityKeyPair = IdentityKeyPair(identityPublic, identityPrivate),
                publicKeyBase64 = publicKeyBase64
            )
        }.getOrNull()
    }

    private fun decodeEcKeyPair(publicKeyBase64: String, privateKeyBase64: String): ECKeyPair? {
        return runCatching {
            val publicKey = ECPublicKey(Base64.getDecoder().decode(publicKeyBase64))
            val privateKey = ECPrivateKey(Base64.getDecoder().decode(privateKeyBase64))
            ECKeyPair(publicKey, privateKey)
        }.getOrNull()
    }

    companion object {
        const val PUB_KEY_PREF = "identity_public_key"
        const val PRIV_KEY_PREF = "identity_private_key"
        const val SIGNAL_IDENTITY_PUBLIC_PREF = "signal_identity_public_key"
        const val SIGNAL_IDENTITY_PRIVATE_PREF = "signal_identity_private_key"
        const val SIGNAL_REGISTRATION_ID_PREF = "signal_registration_id"
        const val SIGNAL_SIGNED_PREKEY_PUBLIC_PREF = "signal_signed_prekey_public"
        const val SIGNAL_SIGNED_PREKEY_PRIVATE_PREF = "signal_signed_prekey_private"
        const val SIGNAL_ONE_TIME_PREKEYS_PREF = "signal_one_time_prekeys"
    }
}
