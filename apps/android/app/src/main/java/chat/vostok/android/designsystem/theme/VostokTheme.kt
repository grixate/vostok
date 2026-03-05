package chat.vostok.android.designsystem.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColorScheme = lightColorScheme(
    primary = TelegramBlue,
    onPrimary = androidx.compose.ui.graphics.Color.White,
    surface = androidx.compose.ui.graphics.Color.White,
    surfaceVariant = SecondaryBackground,
    onSurface = androidx.compose.ui.graphics.Color.Black,
    outline = Separator,
    error = DestructiveRed
)

private val DarkColorScheme = darkColorScheme(
    primary = TelegramBlue,
    onPrimary = androidx.compose.ui.graphics.Color.White
)

@Composable
fun VostokTheme(
    darkTheme: Boolean = false,
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme,
        typography = VostokTypography,
        shapes = VostokShapes,
        content = content
    )
}
