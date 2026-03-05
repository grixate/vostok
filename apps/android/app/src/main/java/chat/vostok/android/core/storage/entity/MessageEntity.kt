package chat.vostok.android.core.storage.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "message_cache",
    indices = [Index(value = ["chatId", "insertedAt"])]
)
data class MessageEntity(
    @PrimaryKey val id: String,
    val chatId: String,
    val ciphertext: String,
    val insertedAt: String
)
