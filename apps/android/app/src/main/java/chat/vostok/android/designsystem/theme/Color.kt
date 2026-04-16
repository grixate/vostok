package chat.vostok.android.designsystem.theme

import androidx.compose.ui.graphics.Color

/**
 * Vostok color tokens — source of truth: packages/ui-tokens/src/index.ts
 * Matches iOS Colors.swift exactly.
 */

// MARK: – Light theme
val LightBg = Color(0xFFEAEAEA)
val LightBgSecondary = Color(0xFFFFFFFF)
val LightBgTertiary = Color(0xFFF5F5F5)
val LightBgHover = Color(0xFFEFEFEF)
val LightBgActive = Color(0xFFE3E3E3)
val LightBgInput = Color(0xFFF5F5F5)
val LightLabel = Color(0xFF111111)
val LightLabelSecondary = Color(0xFF666666)
val LightLabelTertiary = Color(0xFF999999)
val LightFill = Color(0x0A000000) // rgba(0,0,0,0.04)
val LightSeparator = Color(0x14000000) // rgba(0,0,0,0.08)
val LightSeparatorOpaque = Color(0x0A000000) // rgba(0,0,0,0.04)
val LightBubbleIncoming = Color(0xFFEFEFEF)
val LightBubbleOutgoing = Color(0xFFFFE5CC)
val LightBubbleSystem = Color(0x80FFFFFF) // rgba(255,255,255,0.50)
val LightDanger = Color(0xFFD32F2F)
val LightSuccess = Color(0xFF2DA44E)

// MARK: – Dark theme
val DarkBg = Color(0xFF090909)
val DarkBgSecondary = Color(0xFF111111)
val DarkBgTertiary = Color(0xFF1A1A1A)
val DarkBgHover = Color(0xFF1C1C1C)
val DarkBgActive = Color(0xFF2A2A2A)
val DarkBgInput = Color(0xFF1A1A1A)
val DarkLabel = Color(0xFFFFFFFF)
val DarkLabelSecondary = Color(0xFF888888)
val DarkLabelTertiary = Color(0xFF555555)
val DarkFill = Color(0x0FFFFFFF) // rgba(255,255,255,0.06)
val DarkSeparator = Color(0x09FFFFFF) // rgba(255,255,255,0.035)
val DarkSeparatorOpaque = Color(0x05FFFFFF) // rgba(255,255,255,0.02)
val DarkBubbleIncoming = Color(0xFF1C1C1C)
val DarkBubbleOutgoing = Color(0xFF201B13)
val DarkBubbleSystem = Color(0x4D000000) // rgba(0,0,0,0.30)
val DarkDanger = Color(0xFFE53935)
val DarkSuccess = Color(0xFF34C759)

// MARK: – Shared (same in both themes)
val VostokAccent = Color(0xFFFF5500)
val VostokAccentAlt = Color(0xFFFF9500)
val VostokAccentAmber = Color(0xFFFFB347)
val VostokAccentHover = Color(0xFFE64D00)
val VostokAccentSoftLight = Color(0x1AFF5500) // rgba(255,85,0,0.10)
val VostokAccentSoftDark = Color(0x26FF5500) // rgba(255,85,0,0.15)
val VostokTextAccent = Color(0xFFFF5500)
val VostokTextOnAccent = Color.White
val VostokOnline = Color(0xFF44CF6C)

// MARK: – Peer avatar colors (8-color palette)
val PeerColors = listOf(
    Color(0xFFFF5C5C),
    Color(0xFF4FAE4E),
    Color(0xFFE6A817),
    Color(0xFF009EE6),
    Color(0xFF7B68EE),
    Color(0xFFE667AF),
    Color(0xFF20BFAB),
    Color(0xFFEB7840),
)

/** Returns a deterministic peer color based on a name hash. */
fun peerColorFor(name: String): Color {
    if (name.isEmpty()) return PeerColors[0]
    val hash = name.toByteArray(Charsets.UTF_8).fold(0u) { acc, b ->
        (acc + b.toUInt()) * 31u
    }
    return PeerColors[(hash % PeerColors.size.toUInt()).toInt()]
}

// MARK: – Deprecated aliases (for migration)
@Deprecated("Use VostokAccent", replaceWith = ReplaceWith("VostokAccent"))
val TelegramBlue = VostokAccent
@Deprecated("Use LightBubbleOutgoing", replaceWith = ReplaceWith("LightBubbleOutgoing"))
val BubbleSent = LightBubbleOutgoing
@Deprecated("Use LightBubbleIncoming", replaceWith = ReplaceWith("LightBubbleIncoming"))
val BubbleReceived = LightBubbleIncoming
@Deprecated("Use LightBgTertiary", replaceWith = ReplaceWith("LightBgTertiary"))
val SecondaryBackground = LightBgTertiary
@Deprecated("Use LightSeparator", replaceWith = ReplaceWith("LightSeparator"))
val Separator = LightSeparator
@Deprecated("Use VostokOnline", replaceWith = ReplaceWith("VostokOnline"))
val OnlineGreen = VostokOnline
@Deprecated("Use LightDanger", replaceWith = ReplaceWith("LightDanger"))
val DestructiveRed = LightDanger
