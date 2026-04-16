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
import androidx.compose.ui.res.stringResource
import chat.vostok.android.R
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.designsystem.components.VostokTextField

@Composable
fun RegistrationScreen(authViewModel: AuthViewModel) {
    val state by authViewModel.uiState.collectAsState()

    Column(
        modifier = Modifier.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(stringResource(R.string.create_account))
        VostokTextField(
            value = state.username,
            onValueChange = authViewModel::updateUsername,
            placeholder = stringResource(R.string.choose_username)
        )
        VostokTextField(
            value = state.deviceName,
            onValueChange = authViewModel::updateDeviceName,
            placeholder = stringResource(R.string.device_name)
        )
        VostokButton(
            text = if (state.isLoading) stringResource(R.string.registering) else stringResource(R.string.create_account),
            onClick = authViewModel::register
        )
        if (state.isLoading) {
            CircularProgressIndicator(modifier = Modifier.fillMaxWidth())
        }
        state.successMessage?.let { Text(it) }
        state.error?.let { Text(it) }
    }
}
