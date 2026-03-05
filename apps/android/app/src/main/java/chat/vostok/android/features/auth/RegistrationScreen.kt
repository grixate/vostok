package chat.vostok.android.features.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTextField

@Composable
fun RegistrationScreen(authViewModel: AuthViewModel) {
    val state by authViewModel.uiState.collectAsState()

    Column(
        modifier = Modifier.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Create Account")
        VostokTextField(
            value = state.username,
            onValueChange = authViewModel::updateUsername,
            placeholder = "Choose a username"
        )
        VostokTextField(
            value = state.deviceName,
            onValueChange = authViewModel::updateDeviceName,
            placeholder = "Device name"
        )
        VostokButton(
            text = if (state.isLoading) "Registering..." else "Create Account",
            onClick = authViewModel::register
        )
        if (state.isLoading) {
            CircularProgressIndicator(modifier = Modifier.fillMaxWidth())
        }
        state.successMessage?.let { Text(it) }
        state.error?.let { Text(it) }
    }
}
