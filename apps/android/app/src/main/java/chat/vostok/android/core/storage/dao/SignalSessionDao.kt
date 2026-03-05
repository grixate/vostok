package chat.vostok.android.core.storage.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import chat.vostok.android.core.storage.entity.SignalSessionEntity

@Dao
interface SignalSessionDao {
    @Query("SELECT * FROM signal_session WHERE chatId = :chatId AND peerDeviceId = :peerDeviceId LIMIT 1")
    suspend fun byPeer(chatId: String, peerDeviceId: String): SignalSessionEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: SignalSessionEntity)
}
