package chat.vostok.android.designsystem.components

import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable

@Composable
fun VostokTextField(value: String, onValueChange: (String) -> Unit, placeholder: String) {
    OutlinedTextField(value = value, onValueChange = onValueChange, placeholder = { androidx.compose.material3.Text(placeholder) })
}
