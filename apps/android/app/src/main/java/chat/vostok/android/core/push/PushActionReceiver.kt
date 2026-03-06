package chat.vostok.android.core.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import chat.vostok.android.app.MainActivity
import chat.vostok.android.app.VostokApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class PushActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val chatId = intent.getStringExtra(PushConstants.EXTRA_CHAT_ID).orEmpty()
        val notificationId = intent.getIntExtra(PushConstants.EXTRA_NOTIFICATION_ID, -1)
        val messageId = intent.getStringExtra(PushConstants.EXTRA_MESSAGE_ID)?.takeIf { it.isNotBlank() }

        when (intent.action) {
            PushConstants.ACTION_OPEN_CHAT -> {
                if (chatId.isNotBlank()) {
                    val openIntent = Intent(context, MainActivity::class.java).apply {
                        action = PushConstants.ACTION_OPEN_CHAT
                        putExtra(PushConstants.EXTRA_CHAT_ID, chatId)
                        putExtra(PushConstants.EXTRA_NOTIFICATION_ID, notificationId)
                        putExtra(PushConstants.EXTRA_MESSAGE_ID, messageId)
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_CLEAR_TOP or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP
                    }
                    context.startActivity(openIntent)
                }
                if (notificationId > 0) {
                    PushNotificationManager.clearNotification(context, notificationId)
                }
            }

            PushConstants.ACTION_MARK_READ -> {
                if (chatId.isBlank()) return
                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    val app = context.applicationContext as? VostokApp
                    runCatching {
                        app?.container?.messageRepository?.markChatRead(
                            chatId = chatId,
                            lastReadMessageId = messageId
                        )
                    }
                    if (notificationId > 0) {
                        PushNotificationManager.clearNotification(context, notificationId)
                    }
                    pendingResult.finish()
                }
            }

            PushConstants.ACTION_REPLY -> {
                val replyText = RemoteInput.getResultsFromIntent(intent)
                    ?.getCharSequence(PushConstants.REMOTE_INPUT_REPLY)
                    ?.toString()
                    ?.trim()
                    .orEmpty()
                if (chatId.isBlank() || replyText.isBlank()) return

                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    val app = context.applicationContext as? VostokApp
                    runCatching {
                        app?.container?.messageRepository?.sendTextMessage(
                            chatId = chatId,
                            text = replyText,
                            recipientDeviceIds = emptyList()
                        )
                    }
                    if (notificationId > 0) {
                        PushNotificationManager.clearNotification(context, notificationId)
                    }
                    pendingResult.finish()
                }
            }
        }
    }
}
