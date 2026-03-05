package chat.vostok.android.core.crypto

class SenderKeyManager {
    fun rotateSenderKey(chatId: String): String = "sender-key:$chatId"
}
