package chat.vostok.android.core.storage.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import chat.vostok.android.core.storage.entity.ContactEntity

@Dao
interface ContactDao {
    @Query("SELECT * FROM contact_cache ORDER BY displayName ASC")
    suspend fun all(): List<ContactEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(items: List<ContactEntity>)
}
