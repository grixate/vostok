package chat.vostok.android.designsystem.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color

/**
 * Vostok color schemes — source of truth: packages/ui-tokens/src/index.ts
 * Does NOT use Material You dynamic color. Vostok uses its own orange accent.
 */

private val LightColorScheme = lightColorScheme(
    primary = VostokAccent,
    onPrimary = VostokTextOnAccent,
    primaryContainer = VostokAccentSoftLight,
    onPrimaryContainer = VostokAccent,
    secondary = VostokAccentAlt,
    onSecondary = Color.White,
    background = LightBg,
    onBackground = LightLabel,
    surface = LightBgSecondary,
    onSurface = LightLabel,
    surfaceVariant = LightBgTertiary,
    onSurfaceVariant = LightLabelSecondary,
    outline = LightSeparator,
    outlineVariant = LightSeparatorOpaque,
    error = LightDanger,
    onError = Color.White,
)

private val DarkColorScheme = darkColorScheme(
    primary = VostokAccent,
    onPrimary = VostokTextOnAccent,
    primaryContainer = VostokAccentSoftDark,
    onPrimaryContainer = VostokAccent,
    secondary = VostokAccentAlt,
    onSecondary = Color.White,
    background = DarkBg,
    onBackground = DarkLabel,
    surface = DarkBgSecondary,
    onSurface = DarkLabel,
    surfaceVariant = DarkBgTertiary,
    onSurfaceVariant = DarkLabelSecondary,
    outline = DarkSeparator,
    outlineVariant = DarkSeparatorOpaque,
    error = DarkDanger,
    onError = Color.White,
)

@Composable
fun VostokTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    val extendedColors = if (darkTheme) DarkExtendedColors else LightExtendedColors

    CompositionLocalProvider(LocalVostokColors provides extendedColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = VostokTypography,
            shapes = VostokShapes,
            content = content
        )
    }
}

/**
 * Access Vostok's extended colors from any @Composable function.
 * Usage: `VostokColors.current.bubbleOutgoing`
 */
object VostokColors {
    val current: VostokExtendedColors
        @Composable
        get() = LocalVostokColors.current
}
