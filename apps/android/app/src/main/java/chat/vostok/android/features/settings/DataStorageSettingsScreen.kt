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
import chat.vostok.android.designsystem.theme.VostokColors

@Composable
fun DataStorageSettingsScreen(
    keepMediaDays: Int,
    onKeepMediaChange: (Int) -> Unit,
    cacheLimitMB: Int,
    onCacheLimitChange: (Int) -> Unit,
    onClearData: () -> Unit,
    onBack: () -> Unit,
) {
    val ext = VostokColors.current
    val keepOptions = listOf(7, 30, 90, 365)
    val cacheOptions = listOf(256, 512, 1024, 2048)

    Scaffold(topBar = { VostokTopBar(stringResource(R.string.data_and_storage)) }) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(VostokSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(VostokSpacing.lg),
        ) {
            Text(stringResource(R.string.storage), style = VostokType.headline)

            // Keep media picker
            Text(stringResource(R.string.keep_media), style = VostokType.body)
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                keepOptions.forEachIndexed { index, days ->
                    SegmentedButton(
                        selected = keepMediaDays == days,
                        onClick = { onKeepMediaChange(days) },
                        shape = SegmentedButtonDefaults.itemShape(index, keepOptions.size),
                    ) {
                        Text(keepMediaLabel(days), style = VostokType.small)
                    }
                }
            }

            // Cache limit picker
            Text(stringResource(R.string.cache_limit), style = VostokType.body)
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                cacheOptions.forEachIndexed { index, mb ->
                    SegmentedButton(
                        selected = cacheLimitMB == mb,
                        onClick = { onCacheLimitChange(mb) },
                        shape = SegmentedButtonDefaults.itemShape(index, cacheOptions.size),
                    ) {
                        Text(cacheLimitLabel(mb), style = VostokType.small)
                    }
                }
            }

            Spacer(Modifier.height(VostokSpacing.xl))

            OutlinedButton(
                onClick = onClearData,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = ext.danger),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.clear_all_local_data))
            }
        }
    }
}

private fun keepMediaLabel(days: Int): String = when (days) {
    7 -> "1 wk"
    30 -> "1 mo"
    90 -> "3 mo"
    365 -> "1 yr"
    else -> "${days}d"
}

private fun cacheLimitLabel(mb: Int): String =
    if (mb >= 1024) "${mb / 1024} GB" else "$mb MB"
