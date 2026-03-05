package chat.vostok.android.core.crypto

import java.security.SecureRandom

class MediaCrypto {
    fun randomKeyMaterial(bytes: Int = 32): ByteArray {
        val material = ByteArray(bytes)
        SecureRandom().nextBytes(material)
        return material
    }
}
