package chat.vostok.android.core.repository

import chat.vostok.android.core.crypto.KeyManager
import chat.vostok.android.core.network.ApiClient
import chat.vostok.android.core.network.PublishPrekeysRequest
import chat.vostok.android.core.network.RegisterRequest
import chat.vostok.android.core.network.SessionPayload
import chat.vostok.android.core.storage.SessionStore
import chat.vostok.android.core.storage.StoredSession
import java.util.Base64

class AuthRepository(
    private val apiClient: ApiClient,
    private val keyManager: KeyManager,
    private val sessionStore: SessionStore,
    private val tokenSetter: (String?) -> Unit
) {
    fun currentSession(): StoredSession? = sessionStore.load()

    suspend fun register(username: String, deviceName: String): StoredSession {
        val identityKey = keyManager.publicKeyBase64()
        val signalMaterial = keyManager.prepareSignalPrekeyMaterial(oneTimeCount = 64)

        val registration = apiClient.register(
            RegisterRequest(
                username = username.trim(),
                deviceName = deviceName.trim(),
                deviceIdentityPublicKey = identityKey,
                encryptionPublicKey = signalMaterial.encryptionPublicKey,
                signedPrekey = signalMaterial.signedPrekey,
                signedPrekeySignature = signalMaterial.signedPrekeySignature,
                oneTimePrekeys = signalMaterial.oneTimePrekeys
            )
        )

        tokenSetter(registration.session.token)

        apiClient.publishPrekeys(
            PublishPrekeysRequest(
                signedPrekey = signalMaterial.signedPrekey,
                signedPrekeySignature = signalMaterial.signedPrekeySignature,
                oneTimePrekeys = signalMaterial.oneTimePrekeys,
                replaceOneTimePrekeys = true
            )
        )

        val stored = registration.session.toStoredSession(
            userId = registration.user.id,
            deviceId = registration.device.id,
            username = registration.user.username
        )
        sessionStore.save(stored)
        return stored
    }

    suspend fun login(deviceId: String): StoredSession {
        keyManager.ensureIdentity()
        val challenge = apiClient.challenge(deviceId.trim())
        val signature = keyManager.signBase64(Base64.getDecoder().decode(challenge.challenge))
        val verify = apiClient.verify(
            deviceId = challenge.deviceId,
            challengeId = challenge.challengeId,
            signatureBase64 = signature
        )

        tokenSetter(verify.session.token)
        val me = apiClient.me()
        val stored = verify.session.toStoredSession(
            userId = me.user.id,
            deviceId = me.device.id,
            username = me.user.username
        )
        sessionStore.save(stored)

        runCatching {
            val signalMaterial = keyManager.prepareSignalPrekeyMaterial(oneTimeCount = 64)
            apiClient.publishPrekeys(
                PublishPrekeysRequest(
                    signedPrekey = signalMaterial.signedPrekey,
                    signedPrekeySignature = signalMaterial.signedPrekeySignature,
                    oneTimePrekeys = signalMaterial.oneTimePrekeys,
                    replaceOneTimePrekeys = true
                )
            )
        }

        return stored
    }

    fun logout() {
        tokenSetter(null)
        sessionStore.clear()
    }

    private fun SessionPayload.toStoredSession(
        userId: String,
        deviceId: String,
        username: String?
    ) = StoredSession(
        token = token,
        userId = userId,
        deviceId = deviceId,
        username = username,
        expiresAt = expiresAt
    )
}
