package chat.vostok.android.designsystem.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Extended color tokens that don't map to Material 3 color scheme slots.
 * Provided via CompositionLocal alongside MaterialTheme.
 */
@Immutable
data class VostokExtendedColors(
    val bubbleOutgoing: Color,
    val bubbleIncoming: Color,
    val bubbleSystem: Color,
    val accentSoft: Color,
    val accentAlt: Color,
    val accentAmber: Color,
    val accentHover: Color,
    val textAccent: Color,
    val textOnAccent: Color,
    val labelSecondary: Color,
    val labelTertiary: Color,
    val online: Color,
    val separator: Color,
    val separatorOpaque: Color,
    val fill: Color,
    val bgInput: Color,
    val bgTertiary: Color,
    val bgHover: Color,
    val bgActive: Color,
    val danger: Color,
    val success: Color,
    val peerColors: List<Color>,
)

val LightExtendedColors = VostokExtendedColors(
    bubbleOutgoing = LightBubbleOutgoing,
    bubbleIncoming = LightBubbleIncoming,
    bubbleSystem = LightBubbleSystem,
    accentSoft = VostokAccentSoftLight,
    accentAlt = VostokAccentAlt,
    accentAmber = VostokAccentAmber,
    accentHover = VostokAccentHover,
    textAccent = VostokTextAccent,
    textOnAccent = VostokTextOnAccent,
    labelSecondary = LightLabelSecondary,
    labelTertiary = LightLabelTertiary,
    online = VostokOnline,
    separator = LightSeparator,
    separatorOpaque = LightSeparatorOpaque,
    fill = LightFill,
    bgInput = LightBgInput,
    bgTertiary = LightBgTertiary,
    bgHover = LightBgHover,
    bgActive = LightBgActive,
    danger = LightDanger,
    success = LightSuccess,
    peerColors = PeerColors,
)

val DarkExtendedColors = VostokExtendedColors(
    bubbleOutgoing = DarkBubbleOutgoing,
    bubbleIncoming = DarkBubbleIncoming,
    bubbleSystem = DarkBubbleSystem,
    accentSoft = VostokAccentSoftDark,
    accentAlt = VostokAccentAlt,
    accentAmber = VostokAccentAmber,
    accentHover = VostokAccentHover,
    textAccent = VostokTextAccent,
    textOnAccent = VostokTextOnAccent,
    labelSecondary = DarkLabelSecondary,
    labelTertiary = DarkLabelTertiary,
    online = VostokOnline,
    separator = DarkSeparator,
    separatorOpaque = DarkSeparatorOpaque,
    fill = DarkFill,
    bgInput = DarkBgInput,
    bgTertiary = DarkBgTertiary,
    bgHover = DarkBgHover,
    bgActive = DarkBgActive,
    danger = DarkDanger,
    success = DarkSuccess,
    peerColors = PeerColors,
)

val LocalVostokColors = staticCompositionLocalOf { LightExtendedColors }
