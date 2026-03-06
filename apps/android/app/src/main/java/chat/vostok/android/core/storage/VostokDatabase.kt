package chat.vostok.android.core.storage

import android.content.Context
import androidx.room.migration.Migration
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
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
    version = 3,
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
                    .addMigrations(MIGRATION_2_3)
                    .build()
                    .also { INSTANCE = it }
            }
        }

        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE signal_session ADD COLUMN signalAddressName TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE signal_session ADD COLUMN signalAddressDeviceId INTEGER NOT NULL DEFAULT 1")
                db.execSQL("ALTER TABLE signal_session ADD COLUMN sessionRecord TEXT")
            }
        }
    }
}
