package chat.vostok.android.core.storage.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "contact_cache")
data class ContactEntity(
    @PrimaryKey val username: String,
    val displayName: String,
    val updatedAt: String
)
