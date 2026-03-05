package chat.vostok.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun VostokAvatar(initial: String) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .background(Color(0xFF007AFF), CircleShape),
        contentAlignment = Alignment.Center
    ) {
        Text(text = initial.uppercase(), color = Color.White, fontWeight = FontWeight.Bold)
    }
}
