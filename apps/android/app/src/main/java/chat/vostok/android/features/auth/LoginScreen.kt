package chat.vostok.android.features.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTextField

@Composable
fun LoginScreen(authViewModel: AuthViewModel) {
    val state by authViewModel.uiState.collectAsState()

    Column(
        modifier = Modifier.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Login")
        VostokTextField(
            value = state.deviceId,
            onValueChange = authViewModel::updateDeviceId,
            placeholder = "Device ID"
        )
        VostokButton(
            text = if (state.isLoading) "Logging in..." else "Login",
            onClick = authViewModel::login
        )

        state.successMessage?.let { Text(it) }
        state.error?.let { Text(it) }
    }
}
