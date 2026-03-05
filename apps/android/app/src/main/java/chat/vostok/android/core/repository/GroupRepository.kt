package chat.vostok.android.core.repository

import chat.vostok.android.core.network.ApiClient
import chat.vostok.android.core.network.ChatDto
import chat.vostok.android.core.network.GroupMemberDto
import chat.vostok.android.core.network.SafetyNumberDto

class GroupRepository(
    private val apiClient: ApiClient
) {
    suspend fun createGroup(title: String, members: List<String>): ChatDto {
        return apiClient.createGroupChat(
            title = title.trim(),
            members = members.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        ).chat
    }

    suspend fun renameGroup(chatId: String, title: String): ChatDto {
        return apiClient.renameGroupChat(chatId, title.trim()).chat
    }

    suspend fun members(chatId: String): List<GroupMemberDto> {
        return apiClient.groupMembers(chatId).members
    }

    suspend fun updateMemberRole(chatId: String, userId: String, role: String): GroupMemberDto {
        return apiClient.updateGroupMemberRole(chatId, userId, role).member
    }

    suspend fun removeMember(chatId: String, userId: String): GroupMemberDto {
        return apiClient.removeGroupMember(chatId, userId).member
    }

    suspend fun safetyNumbers(chatId: String): List<SafetyNumberDto> {
        return apiClient.safetyNumbers(chatId).safetyNumbers
    }

    suspend fun verifySafetyNumber(chatId: String, peerDeviceId: String): SafetyNumberDto {
        return apiClient.verifySafetyNumber(chatId, peerDeviceId).safetyNumber
    }
}
