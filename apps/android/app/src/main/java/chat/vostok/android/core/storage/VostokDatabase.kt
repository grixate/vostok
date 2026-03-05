package chat.vostok.android.core.storage

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import chat.vostok.android.core.storage.dao.ChatDao
import chat.vostok.android.core.storage.dao.ContactDao
import chat.vostok.android.core.storage.dao.MessageDao
import chat.vostok.android.core.storage.dao.PendingOutboxDao
import chat.vostok.android.core.storage.dao.SignalSessionDao
import chat.vostok.android.core.storage.entity.ChatEntity
import chat.vostok.android.core.storage.entity.ContactEntity
import chat.vostok.android.core.storage.entity.MessageEntity
import chat.vostok.android.core.storage.entity.PendingOutboxEntity
import chat.vostok.android.core.storage.entity.SignalSessionEntity
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory

@Database(
    entities = [
        ChatEntity::class,
        MessageEntity::class,
        ContactEntity::class,
        PendingOutboxEntity::class,
        SignalSessionEntity::class
    ],
    version = 2,
    exportSchema = true
)
abstract class VostokDatabase : RoomDatabase() {
    abstract fun chatDao(): ChatDao
    abstract fun messageDao(): MessageDao
    abstract fun contactDao(): ContactDao
    abstract fun pendingOutboxDao(): PendingOutboxDao
    abstract fun signalSessionDao(): SignalSessionDao

    companion object {
        @Volatile
        private var INSTANCE: VostokDatabase? = null

        fun getInstance(context: Context, passphrase: ByteArray): VostokDatabase {
            return INSTANCE ?: synchronized(this) {
                val factory = SupportOpenHelperFactory(passphrase)
                Room.databaseBuilder(context, VostokDatabase::class.java, "vostok.db")
                    .openHelperFactory(factory)
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
