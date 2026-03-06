package chat.vostok.android.core.crypto

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.SecureRandom
import java.util.Base64

enum class SigningProviderKind(
    val label: String,
    val nonExportable: Boolean
) {
    LEGACY_PREFS(label = "Encrypted prefs legacy key", nonExportable = false),
    ANDROID_KEYSTORE(label = "Android Keystore Ed25519", nonExportable = true)
}

object SigningProviderSelection {
    fun choose(
        persistedKind: SigningProviderKind? = null,
        hasLegacyIdentity: Boolean,
        keystoreSupported: Boolean,
        keystoreHasIdentity: Boolean
    ): SigningProviderKind {
        persistedKind?.let { persisted ->
            return when (persisted) {
                SigningProviderKind.LEGACY_PREFS -> {
                    if (hasLegacyIdentity) SigningProviderKind.LEGACY_PREFS
                    else if (keystoreSupported || keystoreHasIdentity) SigningProviderKind.ANDROID_KEYSTORE
                    else SigningProviderKind.LEGACY_PREFS
                }

                SigningProviderKind.ANDROID_KEYSTORE -> {
                    if (keystoreSupported || keystoreHasIdentity) SigningProviderKind.ANDROID_KEYSTORE
                    else if (hasLegacyIdentity) SigningProviderKind.LEGACY_PREFS
                    else SigningProviderKind.LEGACY_PREFS
                }
            }
        }

        return when {
            hasLegacyIdentity -> SigningProviderKind.LEGACY_PREFS
            keystoreHasIdentity -> SigningProviderKind.ANDROID_KEYSTORE
            keystoreSupported -> SigningProviderKind.ANDROID_KEYSTORE
            else -> SigningProviderKind.LEGACY_PREFS
        }
    }

    fun decode(raw: String?): SigningProviderKind? {
        return raw?.takeIf { it.isNotBlank() }?.let { value ->
            SigningProviderKind.entries.firstOrNull { it.name == value }
        }
    }
}

internal object Ed25519PublicKeyEncoding {
    private val x509Prefix = byteArrayOf(
        0x30, 0x2A, 0x30, 0x05, 0x06, 0x03, 0x2B, 0x65, 0x70, 0x03, 0x21, 0x00
    )

    fun rawPublicKeyFromEncoded(encoded: ByteArray): ByteArray {
        if (encoded.size == 32) return encoded
        if (encoded.size == x509Prefix.size + 32 && encoded.copyOfRange(0, x509Prefix.size).contentEquals(x509Prefix)) {
            return encoded.copyOfRange(x509Prefix.size, encoded.size)
        }
        throw IllegalArgumentException("Unsupported Ed25519 public key encoding")
    }
}

interface SigningKeyProvider {
    val kind: SigningProviderKind
    fun hasIdentity(): Boolean
    fun ensureIdentity(): String
    fun signBase64(payload: ByteArray): String

    fun summary(): String = buildString {
        append(kind.label)
        append(", non-exportable=")
        append(kind.nonExportable)
    }
}

internal class CompositeSigningKeyProvider(
    private val prefs: SharedPreferences
) : SigningKeyProvider {
    private val legacyProvider = LegacyPreferenceSigningKeyProvider(prefs)
    private val keystoreProvider = AndroidKeystoreSigningKeyProvider()
    private val delegateKind: SigningProviderKind by lazy {
        val kind = SigningProviderSelection.choose(
            persistedKind = SigningProviderSelection.decode(prefs.getString(PROVIDER_KIND_PREF, null)),
            hasLegacyIdentity = legacyProvider.hasIdentity(),
            keystoreSupported = keystoreProvider.isSupported(),
            keystoreHasIdentity = keystoreProvider.hasIdentity()
        )
        prefs.edit().putString(PROVIDER_KIND_PREF, kind.name).apply()
        kind
    }
    private val delegate: SigningKeyProvider by lazy {
        when (delegateKind) {
            SigningProviderKind.LEGACY_PREFS -> legacyProvider
            SigningProviderKind.ANDROID_KEYSTORE -> keystoreProvider
        }
    }

    override val kind: SigningProviderKind
        get() = delegate.kind

    override fun hasIdentity(): Boolean = delegate.hasIdentity()

    override fun ensureIdentity(): String = delegate.ensureIdentity()

    override fun signBase64(payload: ByteArray): String = delegate.signBase64(payload)

    private companion object {
        const val PROVIDER_KIND_PREF = "auth_signing_provider_kind"
    }
}

private class LegacyPreferenceSigningKeyProvider(
    private val prefs: SharedPreferences,
    private val random: SecureRandom = SecureRandom()
) : SigningKeyProvider {
    override val kind: SigningProviderKind = SigningProviderKind.LEGACY_PREFS

    override fun hasIdentity(): Boolean {
        val existingPublic = prefs.getString(KeyManager.PUB_KEY_PREF, null)
        val existingPrivate = prefs.getString(KeyManager.PRIV_KEY_PREF, null)
        return !existingPublic.isNullOrBlank() && !existingPrivate.isNullOrBlank()
    }

    override fun ensureIdentity(): String {
        val existingPublic = prefs.getString(KeyManager.PUB_KEY_PREF, null)
        val existingPrivate = prefs.getString(KeyManager.PRIV_KEY_PREF, null)
        if (!existingPublic.isNullOrBlank() && !existingPrivate.isNullOrBlank()) {
            return existingPublic
        }

        val privateKey = Ed25519PrivateKeyParameters(random)
        val publicKey = privateKey.generatePublicKey().encoded

        prefs.edit()
            .putString(KeyManager.PRIV_KEY_PREF, Base64.getEncoder().encodeToString(privateKey.encoded))
            .putString(KeyManager.PUB_KEY_PREF, Base64.getEncoder().encodeToString(publicKey))
            .apply()

        return Base64.getEncoder().encodeToString(publicKey)
    }

    override fun signBase64(payload: ByteArray): String {
        ensureIdentity()
        val privateBase64 = prefs.getString(KeyManager.PRIV_KEY_PREF, null)
            ?: error("Identity private key missing")
        val privateRaw = Base64.getDecoder().decode(privateBase64)
        val privateKey = Ed25519PrivateKeyParameters(privateRaw, 0)

        val signer = Ed25519Signer()
        signer.init(true, privateKey)
        signer.update(payload, 0, payload.size)
        return Base64.getEncoder().encodeToString(signer.generateSignature())
    }
}

private class AndroidKeystoreSigningKeyProvider : SigningKeyProvider {
    override val kind: SigningProviderKind = SigningProviderKind.ANDROID_KEYSTORE

    fun isSupported(): Boolean {
        return runCatching {
            KeyPairGenerator.getInstance("Ed25519", "AndroidKeyStore")
        }.isSuccess
    }

    override fun hasIdentity(): Boolean {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return keyStore.containsAlias(ALIAS)
    }

    override fun ensureIdentity(): String {
        ensureKeyPair()
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val certificate = keyStore.getCertificate(ALIAS) ?: error("Missing keystore certificate")
        val rawPublicKey = Ed25519PublicKeyEncoding.rawPublicKeyFromEncoded(certificate.publicKey.encoded)
        return Base64.getEncoder().encodeToString(rawPublicKey)
    }

    override fun signBase64(payload: ByteArray): String {
        ensureKeyPair()
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val privateKey = keyStore.getKey(ALIAS, null) as? PrivateKey
            ?: error("Missing keystore private key")
        val signature = Signature.getInstance("Ed25519")
        signature.initSign(privateKey)
        signature.update(payload)
        return Base64.getEncoder().encodeToString(signature.sign())
    }

    private fun ensureKeyPair() {
        if (hasIdentity()) return

        val generator = KeyPairGenerator.getInstance("Ed25519", "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(
            ALIAS,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
        ).build()
        generator.initialize(spec)
        generator.generateKeyPair()
    }

    private companion object {
        const val ALIAS = "vostok_auth_signing_ed25519"
    }
}
