package chat.vostok.android.core.push

object PushConstants {
    const val CHANNEL_MESSAGES = "vostok_messages"

    const val ACTION_OPEN_CHAT = "chat.vostok.android.push.OPEN_CHAT"
    const val ACTION_MARK_READ = "chat.vostok.android.push.MARK_READ"
    const val ACTION_REPLY = "chat.vostok.android.push.REPLY"

    const val EXTRA_CHAT_ID = "chat_id"
    const val EXTRA_NOTIFICATION_ID = "notification_id"
    const val EXTRA_MESSAGE_ID = "message_id"

    const val REMOTE_INPUT_REPLY = "remote_input_reply"
}
