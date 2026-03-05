package chat.vostok.android.features.contacts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import chat.vostok.android.core.repository.ContactListItemModel
import chat.vostok.android.core.repository.ContactRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ContactListUiState(
    val items: List<ContactListItemModel> = emptyList(),
    val search: String = "",
    val isLoading: Boolean = false,
    val error: String? = null
)

class ContactListViewModel(
    private val contactRepository: ContactRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(ContactListUiState())
    val uiState: StateFlow<ContactListUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun updateSearch(value: String) {
        _uiState.value = _uiState.value.copy(search = value)
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching { contactRepository.contacts() }
                .onSuccess { items ->
                    _uiState.value = _uiState.value.copy(items = items, isLoading = false)
                }
                .onFailure { throwable ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = throwable.message ?: "Failed to load contacts"
                    )
                }
        }
    }

    suspend fun openOrCreateDirect(username: String): String {
        return contactRepository.ensureDirectChat(username)
    }

    class Factory(
        private val contactRepository: ContactRepository
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return ContactListViewModel(contactRepository) as T
        }
    }
}
