package chat.vostok.android.core.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class SigningKeyProviderSupportTest {
    @Test
    fun providerSelection_preservesLegacyIdentityWhenPresent() {
        assertEquals(
            SigningProviderKind.LEGACY_PREFS,
            SigningProviderSelection.choose(
                persistedKind = null,
                hasLegacyIdentity = true,
                keystoreSupported = true,
                keystoreHasIdentity = false
            )
        )
    }

    @Test
    fun providerSelection_prefersKeystoreForNewSupportedInstall() {
        assertEquals(
            SigningProviderKind.ANDROID_KEYSTORE,
            SigningProviderSelection.choose(
                persistedKind = null,
                hasLegacyIdentity = false,
                keystoreSupported = true,
                keystoreHasIdentity = false
            )
        )
    }

    @Test
    fun providerSelection_respectsPersistedLegacyMigrationChoice() {
        assertEquals(
            SigningProviderKind.LEGACY_PREFS,
            SigningProviderSelection.choose(
                persistedKind = SigningProviderKind.LEGACY_PREFS,
                hasLegacyIdentity = true,
                keystoreSupported = true,
                keystoreHasIdentity = true
            )
        )
    }

    @Test
    fun providerSelection_fallsBackWhenPersistedKeystoreIsUnavailable() {
        assertEquals(
            SigningProviderKind.LEGACY_PREFS,
            SigningProviderSelection.choose(
                persistedKind = SigningProviderKind.ANDROID_KEYSTORE,
                hasLegacyIdentity = true,
                keystoreSupported = false,
                keystoreHasIdentity = false
            )
        )
    }

    @Test
    fun providerSelection_decodesPersistedKindSafely() {
        assertEquals(
            SigningProviderKind.ANDROID_KEYSTORE,
            SigningProviderSelection.decode(SigningProviderKind.ANDROID_KEYSTORE.name)
        )
        assertEquals(null, SigningProviderSelection.decode("unknown"))
    }

    @Test
    fun rawEd25519PublicKey_decodesKnownX509Prefix() {
        val rawKey = ByteArray(32) { index -> (index + 1).toByte() }
        val encoded = byteArrayOf(
            0x30, 0x2A, 0x30, 0x05, 0x06, 0x03, 0x2B, 0x65, 0x70, 0x03, 0x21, 0x00
        ) + rawKey

        assertArrayEquals(rawKey, Ed25519PublicKeyEncoding.rawPublicKeyFromEncoded(encoded))
    }
}
