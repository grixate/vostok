package chat.vostok.android.designsystem.components

import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

@Composable
fun VostokTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .defaultMinSize(minHeight = 48.dp)
            .semantics { contentDescription = placeholder },
        placeholder = { Text(placeholder) }
    )
}
