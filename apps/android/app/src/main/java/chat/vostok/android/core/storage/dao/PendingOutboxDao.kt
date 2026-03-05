package chat.vostok.android.core.storage.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import chat.vostok.android.core.storage.entity.PendingOutboxEntity

@Dao
interface PendingOutboxDao {
    @Query("SELECT * FROM pending_outbox ORDER BY createdAt ASC")
    suspend fun all(): List<PendingOutboxEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(items: List<PendingOutboxEntity>)

    @Query("DELETE FROM pending_outbox WHERE clientId = :clientId")
    suspend fun remove(clientId: String)

    @Query("DELETE FROM pending_outbox")
    suspend fun clear()
}
