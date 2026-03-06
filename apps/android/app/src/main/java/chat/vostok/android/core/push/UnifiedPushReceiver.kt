package chat.vostok.android.core.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import chat.vostok.android.app.VostokApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class UnifiedPushReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val extras = intent.extras
        val chatId = extras?.getString(PushConstants.EXTRA_CHAT_ID).orEmpty()
        val title = extras?.getString("title") ?: "Vostok"
        val body = extras?.getString("body") ?: "New message"
        val messageId = extras?.getString(PushConstants.EXTRA_MESSAGE_ID)
        val possibleToken = listOf(
            extras?.getString("token"),
            extras?.getString("endpoint"),
            extras?.getString("unifiedpush.token")
        ).firstOrNull { !it.isNullOrBlank() }

        if (!possibleToken.isNullOrBlank()) {
            val app = context.applicationContext as? VostokApp
            if (app != null) {
                CoroutineScope(Dispatchers.IO).launch {
                    runCatching {
                        app.container.deviceRepository.registerPushToken(
                            pushProvider = "unifiedpush",
                            pushToken = possibleToken
                        )
                    }
                }
            }
        }

        if (chatId.isBlank()) {
            Log.d("UnifiedPushReceiver", "intent without chat_id: ${intent.action}")
            return
        }

        PushNotificationManager.showChatNotification(
            context = context,
            chatId = chatId,
            title = title,
            body = body,
            messageId = messageId
        )
    }
}
