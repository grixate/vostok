package chat.vostok.android.features.conversation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

@Composable
fun MessageBubble(text: String, isOutgoing: Boolean, footer: String? = null) {
    val background = if (isOutgoing) Color(0xFFE4FFC7) else Color(0xFFFFFFFF)
    val bubbleShape = RoundedCornerShape(
        topStart = 18.dp,
        topEnd = 18.dp,
        bottomStart = if (isOutgoing) 18.dp else 6.dp,
        bottomEnd = if (isOutgoing) 6.dp else 18.dp
    )
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isOutgoing) Arrangement.End else Arrangement.Start
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .background(background, bubbleShape)
                .semantics {
                    contentDescription = buildString {
                        append(if (isOutgoing) "Outgoing message" else "Incoming message")
                        if (text.isNotBlank()) {
                            append(", ")
                            append(text)
                        }
                        if (!footer.isNullOrBlank()) {
                            append(", ")
                            append(footer)
                        }
                    }
                }
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            BubbleBody(text = text)
            footer?.let {
                Spacer(modifier = Modifier.height(4.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun BubbleBody(text: String) {
    when {
        text.startsWith("Voice message") -> {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(
                    imageVector = Icons.Outlined.GraphicEq,
                    contentDescription = "Voice message",
                    tint = MaterialTheme.colorScheme.primary
                )
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Voice Message", style = MaterialTheme.typography.labelLarge)
                    Text(text, style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        text.startsWith("Round video") -> {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(
                    imageVector = Icons.Outlined.PlayCircle,
                    contentDescription = "Round video",
                    tint = MaterialTheme.colorScheme.primary
                )
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Round Video", style = MaterialTheme.typography.labelLarge)
                    Text(text, style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        text.startsWith("Attachment:") -> {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(
                    imageVector = Icons.Outlined.AttachFile,
                    contentDescription = "Attachment",
                    tint = MaterialTheme.colorScheme.primary
                )
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Attachment", style = MaterialTheme.typography.labelLarge)
                    Text(text.removePrefix("Attachment: ").trim(), style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        else -> {
            Text(text = text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
