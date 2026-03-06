package chat.vostok.android.core.storage.entity

import androidx.room.Entity
import androidx.room.Index

@Entity(
    tableName = "signal_session",
    primaryKeys = ["chatId", "peerDeviceId"],
    indices = [Index(value = ["chatId", "peerDeviceId"], unique = true)]
)
data class SignalSessionEntity(
    val chatId: String,
    val peerDeviceId: String,
    val sessionId: String,
    val status: String,
    val signalAddressName: String,
    val signalAddressDeviceId: Int,
    val sessionRecord: String?,
    val updatedAt: String
)
