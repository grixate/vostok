package chat.vostok.android.core.storage.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import chat.vostok.android.core.storage.entity.ChatEntity

@Dao
interface ChatDao {
    @Query("SELECT * FROM chat_cache ORDER BY updatedAt DESC")
    suspend fun all(): List<ChatEntity>

    @Query("DELETE FROM chat_cache")
    suspend fun clear()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(items: List<ChatEntity>)
}
