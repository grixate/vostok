package chat.vostok.android.features.media

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton

@Composable
fun MediaPickerSheet(
    linkUrl: String,
    onLinkUrlChange: (String) -> Unit,
    onFetchLinkMetadata: () -> Unit,
    isLoading: Boolean
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text("Link Metadata")
        OutlinedTextField(
            value = linkUrl,
            onValueChange = onLinkUrlChange,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("https://example.com") }
        )
        VostokButton(
            text = if (isLoading) "Fetching..." else "Fetch Link Metadata",
            onClick = onFetchLinkMetadata
        )
    }
}
