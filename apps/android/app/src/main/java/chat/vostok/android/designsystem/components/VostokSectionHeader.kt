package chat.vostok.android.designsystem.components

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.font.FontWeight

@Composable
fun VostokSectionHeader(text: String) {
    Text(text = text, fontWeight = FontWeight.SemiBold)
}
