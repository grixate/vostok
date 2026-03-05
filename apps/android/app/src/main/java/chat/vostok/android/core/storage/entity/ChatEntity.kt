package chat.vostok.android.core.storage.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "chat_cache")
data class ChatEntity(
    @PrimaryKey val id: String,
    val title: String,
    val updatedAt: String
)
