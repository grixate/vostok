package chat.vostok.android.core.push

import android.util.Log
import chat.vostok.android.app.VostokApp
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class FcmService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Log.d("FcmService", "new token: $token")
        val app = application as? VostokApp ?: return
        CoroutineScope(Dispatchers.IO).launch {
            runCatching {
                app.container.deviceRepository.registerPushToken(
                    pushProvider = "fcm",
                    pushToken = token
                )
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val chatId = message.data[PushConstants.EXTRA_CHAT_ID].orEmpty()
        val title = message.data["title"]
            ?: message.notification?.title
            ?: "Vostok"
        val body = message.data["body"]
            ?: message.notification?.body
            ?: "New message"
        val messageId = message.data[PushConstants.EXTRA_MESSAGE_ID]

        if (chatId.isBlank()) {
            Log.d("FcmService", "missing chat_id in push payload: ${message.data}")
            return
        }

        PushNotificationManager.showChatNotification(
            context = this,
            chatId = chatId,
            title = title,
            body = body,
            messageId = messageId
        )
    }
}
