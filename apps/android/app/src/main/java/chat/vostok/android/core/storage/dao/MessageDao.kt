package chat.vostok.android.core.storage.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import chat.vostok.android.core.storage.entity.MessageEntity

@Dao
interface MessageDao {
    @Query("SELECT * FROM message_cache WHERE chatId = :chatId ORDER BY insertedAt ASC")
    suspend fun byChat(chatId: String): List<MessageEntity>

    @Query("DELETE FROM message_cache WHERE chatId = :chatId")
    suspend fun clearChat(chatId: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(items: List<MessageEntity>)
}
