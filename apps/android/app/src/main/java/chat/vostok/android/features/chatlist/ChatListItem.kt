package chat.vostok.android.features.chatlist

import androidx.compose.runtime.Composable
import chat.vostok.android.designsystem.components.VostokListItem

@Composable
fun ChatListItem(title: String, preview: String) {
    VostokListItem(title = title, subtitle = preview)
}
