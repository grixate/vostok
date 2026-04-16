package chat.vostok.android.designsystem.theme

import androidx.compose.ui.unit.dp

/**
 * Vostok spacing tokens — source of truth: packages/ui-tokens/src/index.ts
 */
object VostokSpacing {
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
}

/**
 * Vostok viewport dimensions — source of truth: packages/ui-tokens/src/index.ts
 */
object VostokDimensions {
    val chatRowHeight = 72.dp
    val avatarList = 48.dp
    val avatarHeader = 40.dp
    val avatarMessage = 34.dp
    val avatarCompact = 32.dp
    val settingsRowHeight = 52.dp
}

/**
 * Vostok motion durations (milliseconds).
 */
object VostokMotion {
    const val fast = 100   // toggles, small interactions
    const val base = 150   // default transitions
    const val slow = 200   // sheet/modal presentations
}
