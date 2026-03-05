package chat.vostok.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
fun VostokBadge(text: String) {
    Box(modifier = Modifier.background(Color(0xFF007AFF), CircleShape).padding(horizontal = 8.dp, vertical = 2.dp)) {
        Text(text = text, color = Color.White)
    }
}
