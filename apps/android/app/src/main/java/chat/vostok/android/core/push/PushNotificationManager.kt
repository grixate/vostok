package chat.vostok.android.core.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import chat.vostok.android.R
import chat.vostok.android.app.MainActivity

object PushNotificationManager {
    fun showChatNotification(
        context: Context,
        chatId: String,
        title: String,
        body: String,
        messageId: String? = null
    ) {
        if (chatId.isBlank()) return
        ensureChannels(context)

        val notificationId = stableNotificationId(chatId, messageId)
        val openIntent = Intent(context, MainActivity::class.java).apply {
            action = PushConstants.ACTION_OPEN_CHAT
            putExtra(PushConstants.EXTRA_CHAT_ID, chatId)
            putExtra(PushConstants.EXTRA_NOTIFICATION_ID, notificationId)
            putExtra(PushConstants.EXTRA_MESSAGE_ID, messageId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openPendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val markReadIntent = Intent(context, PushActionReceiver::class.java).apply {
            action = PushConstants.ACTION_MARK_READ
            putExtra(PushConstants.EXTRA_CHAT_ID, chatId)
            putExtra(PushConstants.EXTRA_NOTIFICATION_ID, notificationId)
            putExtra(PushConstants.EXTRA_MESSAGE_ID, messageId)
        }
        val markReadPendingIntent = PendingIntent.getBroadcast(
            context,
            notificationId + 1,
            markReadIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val replyIntent = Intent(context, PushActionReceiver::class.java).apply {
            action = PushConstants.ACTION_REPLY
            putExtra(PushConstants.EXTRA_CHAT_ID, chatId)
            putExtra(PushConstants.EXTRA_NOTIFICATION_ID, notificationId)
            putExtra(PushConstants.EXTRA_MESSAGE_ID, messageId)
        }
        val replyPendingIntent = PendingIntent.getBroadcast(
            context,
            notificationId + 2,
            replyIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        val remoteInput = RemoteInput.Builder(PushConstants.REMOTE_INPUT_REPLY)
            .setLabel(context.getString(R.string.send))
            .build()

        val notification = NotificationCompat.Builder(context, PushConstants.CHANNEL_MESSAGES)
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle(title.ifBlank { "Vostok" })
            .setContentText(body.ifBlank { "New message" })
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openPendingIntent)
            .addAction(
                NotificationCompat.Action.Builder(
                    android.R.drawable.ic_menu_view,
                    "Open",
                    openPendingIntent
                ).build()
            )
            .addAction(
                NotificationCompat.Action.Builder(
                    android.R.drawable.ic_menu_close_clear_cancel,
                    "Mark read",
                    markReadPendingIntent
                ).build()
            )
            .addAction(
                NotificationCompat.Action.Builder(
                    android.R.drawable.ic_menu_send,
                    "Reply",
                    replyPendingIntent
                ).addRemoteInput(remoteInput).build()
            )
            .build()

        NotificationManagerCompat.from(context).notify(notificationId, notification)
    }

    fun clearNotification(context: Context, notificationId: Int) {
        NotificationManagerCompat.from(context).cancel(notificationId)
    }

    private fun stableNotificationId(chatId: String, messageId: String?): Int {
        val input = "$chatId:${messageId.orEmpty()}"
        val hash = input.hashCode() and Int.MAX_VALUE
        return if (hash == 0) 1 else hash
    }

    private fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            PushConstants.CHANNEL_MESSAGES,
            "Messages",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Chat notifications"
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }
}
