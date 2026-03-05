package chat.vostok.android.core.storage.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "pending_outbox",
    indices = [Index(value = ["chatId", "createdAt"])]
)
data class PendingOutboxEntity(
    @PrimaryKey val clientId: String,
    val chatId: String,
    val payload: String,
    val createdAt: String
)
