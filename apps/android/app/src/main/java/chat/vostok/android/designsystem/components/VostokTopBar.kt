package chat.vostok.android.designsystem.components

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VostokTopBar(title: String) {
    TopAppBar(
        title = {
            Text(
                text = title,
                modifier = androidx.compose.ui.Modifier.semantics { heading() }
            )
        }
    )
}
