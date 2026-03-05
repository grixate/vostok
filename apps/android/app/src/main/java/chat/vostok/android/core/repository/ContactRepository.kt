package chat.vostok.android.core.repository

import chat.vostok.android.core.network.ApiClient
import chat.vostok.android.core.network.ChatDto
import chat.vostok.android.core.network.PrekeyBundleDto

data class ContactListItemModel(
    val username: String,
    val subtitle: String,
    val prekeyDeviceCount: Int
)

class ContactRepository(
    private val apiClient: ApiClient
) {
    suspend fun contacts(): List<ContactListItemModel> {
        val chats = apiClient.chats().chats
        val usernames = chats
            .flatMap(ChatDto::participantUsernames)
            .map(String::trim)
            .filter(String::isNotEmpty)
            .distinct()
            .sorted()

        return usernames.map { username ->
            val prekeys = runCatching { apiClient.userPrekeys(username).devices }.getOrDefault(emptyList())
            ContactListItemModel(
                username = username,
                subtitle = if (prekeys.isEmpty()) "No active device prekeys" else "${prekeys.size} active devices",
                prekeyDeviceCount = prekeys.size
            )
        }
    }

    suspend fun ensureDirectChat(username: String): String {
        return apiClient.createDirectChat(username.trim()).chat.id
    }

    suspend fun prekeys(username: String): List<PrekeyBundleDto> = apiClient.userPrekeys(username).devices
}
