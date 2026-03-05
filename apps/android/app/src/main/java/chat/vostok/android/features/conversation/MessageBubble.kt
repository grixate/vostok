package chat.vostok.android.features.conversation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
fun MessageBubble(text: String, isOutgoing: Boolean, footer: String? = null) {
    val background = if (isOutgoing) Color(0xFFD8FEC7) else MaterialTheme.colorScheme.surfaceVariant
    Column(
        modifier = Modifier
            .background(background, RoundedCornerShape(14.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        Text(text = text)
        footer?.let { Text(text = it, style = MaterialTheme.typography.labelSmall) }
    }
}
