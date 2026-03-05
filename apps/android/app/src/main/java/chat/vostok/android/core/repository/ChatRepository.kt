package chat.vostok.android.core.repository

import chat.vostok.android.core.network.ApiClient
import chat.vostok.android.core.network.ChatDto
import chat.vostok.android.core.network.MessageDto
import chat.vostok.android.core.storage.dao.ChatDao
import chat.vostok.android.core.storage.dao.MessageDao
import chat.vostok.android.core.storage.entity.ChatEntity
import chat.vostok.android.core.storage.entity.MessageEntity

data class ChatListItemModel(
    val id: String,
    val title: String,
    val subtitle: String,
    val updatedAt: String?
)

class ChatRepository(
    private val apiClient: ApiClient,
    private val chatDao: ChatDao,
    private val messageDao: MessageDao
) {
    suspend fun chats(): List<ChatListItemModel> {
        return runCatching {
            val remote = apiClient.chats().chats
            chatDao.clear()
            chatDao.upsert(remote.map { it.toEntity() })
            remote.map { it.toItemModel() }
        }.getOrElse {
            chatDao.all().map { entity ->
                ChatListItemModel(
                    id = entity.id,
                    title = entity.title,
                    subtitle = "cached",
                    updatedAt = entity.updatedAt
                )
            }
        }
    }

    suspend fun syncChats(): List<ChatListItemModel> = chats()

    suspend fun messages(chatId: String): List<MessageDto> {
        return runCatching {
            val remote = apiClient.messages(chatId).messages
            messageDao.upsert(remote.map { it.toEntity() })
            remote
        }.getOrElse {
            messageDao.byChat(chatId).map { it.toMessageDto() }
        }
    }

    suspend fun syncMessages(chatId: String): List<MessageDto> = messages(chatId)

    suspend fun ensureDirectChat(username: String): ChatDto = apiClient.createDirectChat(username).chat

    suspend fun upsertMessageFromRemote(chatId: String, messageId: String): MessageDto? {
        val remote = runCatching { apiClient.messages(chatId).messages }.getOrNull() ?: return null
        messageDao.upsert(remote.map { it.toEntity() })
        return remote.firstOrNull { it.id == messageId }
    }

    private fun ChatDto.toEntity() = ChatEntity(
        id = id,
        title = title,
        updatedAt = latestMessageAt ?: ""
    )

    private fun MessageDto.toEntity() = MessageEntity(
        id = id,
        chatId = chatId,
        ciphertext = ciphertext.orEmpty(),
        insertedAt = insertedAt
    )

    private fun MessageEntity.toMessageDto() = MessageDto(
        id = id,
        chatId = chatId,
        messageKind = "text",
        senderDeviceId = "cached",
        insertedAt = insertedAt,
        ciphertext = ciphertext
    )

    private fun ChatDto.toItemModel() = ChatListItemModel(
        id = id,
        title = title,
        subtitle = when {
            isSelfChat -> "Saved Messages"
            participantUsernames.isNotEmpty() -> participantUsernames.joinToString(", ")
            else -> type
        },
        updatedAt = latestMessageAt
    )
}
