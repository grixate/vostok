package chat.vostok.android.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import chat.vostok.android.R
import chat.vostok.android.designsystem.components.VostokTopBar
import chat.vostok.android.designsystem.theme.VostokSpacing
import chat.vostok.android.designsystem.theme.VostokType

enum class ThemeMode { SYSTEM, LIGHT, DARK }

@Composable
fun AppearanceSettingsScreen(
    themeMode: ThemeMode,
    onThemeChange: (ThemeMode) -> Unit,
    language: String,
    onLanguageChange: (String) -> Unit,
    onBack: () -> Unit,
) {
    Scaffold(topBar = { VostokTopBar(stringResource(R.string.appearance)) }) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(VostokSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(VostokSpacing.lg),
        ) {
            // Theme
            Text(stringResource(R.string.theme), style = VostokType.headline)
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                ThemeMode.entries.forEachIndexed { index, mode ->
                    SegmentedButton(
                        selected = themeMode == mode,
                        onClick = { onThemeChange(mode) },
                        shape = SegmentedButtonDefaults.itemShape(index, ThemeMode.entries.size),
                    ) {
                        Text(mode.name.lowercase().replaceFirstChar { it.uppercase() }, style = VostokType.small)
                    }
                }
            }

            Spacer(Modifier.height(VostokSpacing.sm))

            // Language
            Text(stringResource(R.string.language), style = VostokType.headline)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(VostokSpacing.sm),
            ) {
                FilterChip(
                    selected = language == "en",
                    onClick = { onLanguageChange("en") },
                    label = { Text("English") },
                )
                FilterChip(
                    selected = language == "ru",
                    onClick = { onLanguageChange("ru") },
                    label = { Text("Русский") },
                )
            }
        }
    }
}
