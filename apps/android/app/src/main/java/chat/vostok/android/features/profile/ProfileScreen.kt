package chat.vostok.android.features.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import chat.vostok.android.R
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTopBar

@Composable
fun ProfileScreen(
    username: String?,
    userId: String?,
    deviceId: String?,
    onBack: () -> Unit
) {
    androidx.compose.material3.Scaffold(topBar = { VostokTopBar(stringResource(R.string.profile)) }) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text("${stringResource(R.string.username)}: ${username ?: "-"}")
            Text("${stringResource(R.string.user_id)}: ${userId ?: "-"}")
            Text("${stringResource(R.string.device_id)}: ${deviceId ?: "-"}")
            VostokButton(text = stringResource(R.string.back), onClick = onBack)
        }
    }
}
