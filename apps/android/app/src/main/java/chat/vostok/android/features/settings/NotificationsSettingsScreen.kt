package chat.vostok.android.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import chat.vostok.android.R
import chat.vostok.android.designsystem.components.VostokTopBar
import chat.vostok.android.designsystem.theme.VostokSpacing

@Composable
fun NotificationsSettingsScreen(
    soundEnabled: Boolean,
    onSoundChange: (Boolean) -> Unit,
    badgeEnabled: Boolean,
    onBadgeChange: (Boolean) -> Unit,
    previewEnabled: Boolean,
    onPreviewChange: (Boolean) -> Unit,
    onBack: () -> Unit,
) {
    Scaffold(topBar = { VostokTopBar(stringResource(R.string.notifications_and_sounds)) }) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(VostokSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(VostokSpacing.xs),
        ) {
            SettingsToggle(stringResource(R.string.sound), soundEnabled, onSoundChange)
            SettingsToggle(stringResource(R.string.badge_count), badgeEnabled, onBadgeChange)
            SettingsToggle(stringResource(R.string.message_preview), previewEnabled, onPreviewChange)
        }
    }
}

@Composable
internal fun SettingsToggle(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = VostokSpacing.sm),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}
