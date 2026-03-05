package chat.vostok.android.features.calls

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar

@Composable
fun IncomingCallScreen(onAccept: () -> Unit, onReject: () -> Unit) {
    androidx.compose.material3.Scaffold(topBar = { VostokTopBar("Incoming Call") }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Incoming call request")
            VostokButton(text = "Accept", onClick = onAccept)
            VostokButton(text = "Reject", onClick = onReject)
        }
    }
}
