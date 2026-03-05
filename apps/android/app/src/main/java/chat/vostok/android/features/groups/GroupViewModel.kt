package chat.vostok.android.features.groups

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import chat.vostok.android.core.network.GroupMemberDto
import chat.vostok.android.core.network.SafetyNumberDto
import chat.vostok.android.core.repository.GroupRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class GroupUiState(
    val title: String = "",
    val membersInput: String = "",
    val chatId: String? = null,
    val members: List<GroupMemberDto> = emptyList(),
    val safetyNumbers: List<SafetyNumberDto> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val info: String? = null
)

class GroupViewModel(
    private val groupRepository: GroupRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(GroupUiState())
    val uiState: StateFlow<GroupUiState> = _uiState.asStateFlow()

    fun updateTitle(value: String) {
        _uiState.value = _uiState.value.copy(title = value)
    }

    fun updateMembersInput(value: String) {
        _uiState.value = _uiState.value.copy(membersInput = value)
    }

    fun createGroup() {
        val title = _uiState.value.title.trim()
        if (title.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Group title is required")
            return
        }

        val members = _uiState.value.membersInput
            .split(",")
            .map(String::trim)
            .filter(String::isNotEmpty)

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null, info = null)
            runCatching { groupRepository.createGroup(title, members) }
                .onSuccess { chat ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        chatId = chat.id,
                        info = "Group created: ${chat.title}"
                    )
                    loadGroup(chat.id)
                }
                .onFailure { throwable ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = throwable.message ?: "Failed to create group"
                    )
                }
        }
    }

    fun loadGroup(chatId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(chatId = chatId, isLoading = true, error = null)
            runCatching {
                val members = groupRepository.members(chatId)
                val safety = groupRepository.safetyNumbers(chatId)
                members to safety
            }.onSuccess { (members, safety) ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    members = members,
                    safetyNumbers = safety
                )
            }.onFailure { throwable ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = throwable.message ?: "Failed to load group"
                )
            }
        }
    }

    fun toggleRole(chatId: String, member: GroupMemberDto) {
        val nextRole = if (member.role == "admin") "member" else "admin"
        viewModelScope.launch {
            runCatching { groupRepository.updateMemberRole(chatId, member.userId, nextRole) }
                .onSuccess {
                    _uiState.value = _uiState.value.copy(info = "Role changed for ${member.username}")
                    loadGroup(chatId)
                }
                .onFailure { throwable ->
                    _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to update role")
                }
        }
    }

    fun removeMember(chatId: String, member: GroupMemberDto) {
        viewModelScope.launch {
            runCatching { groupRepository.removeMember(chatId, member.userId) }
                .onSuccess {
                    _uiState.value = _uiState.value.copy(info = "Removed ${member.username}")
                    loadGroup(chatId)
                }
                .onFailure { throwable ->
                    _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to remove member")
                }
        }
    }

    fun verifySafety(chatId: String, peerDeviceId: String) {
        viewModelScope.launch {
            runCatching { groupRepository.verifySafetyNumber(chatId, peerDeviceId) }
                .onSuccess {
                    _uiState.value = _uiState.value.copy(info = "Safety number verified")
                    loadGroup(chatId)
                }
                .onFailure { throwable ->
                    _uiState.value = _uiState.value.copy(error = throwable.message ?: "Failed to verify")
                }
        }
    }

    class Factory(
        private val groupRepository: GroupRepository
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return GroupViewModel(groupRepository) as T
        }
    }
}
