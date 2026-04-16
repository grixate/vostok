package chat.vostok.android.designsystem.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import chat.vostok.android.R

/**
 * Vostok typography — Inter font family with token-aligned sizes.
 * Source of truth: packages/ui-tokens/src/index.ts
 */

val InterFontFamily = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_bold, FontWeight.Bold),
)

/**
 * Named typography tokens matching the design system spec.
 * Use these directly in Compose via `VostokType.heading`, etc.
 */
object VostokType {
    /** 22sp Bold — main section titles */
    val heading = TextStyle(fontFamily = InterFontFamily, fontSize = 22.sp, fontWeight = FontWeight.Bold, lineHeight = 26.4.sp)
    /** 16sp SemiBold — subsection titles */
    val headline = TextStyle(fontFamily = InterFontFamily, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, lineHeight = 22.sp)
    /** 15sp Medium (~510) — row titles, list items */
    val title = TextStyle(fontFamily = InterFontFamily, fontSize = 15.sp, fontWeight = FontWeight.Medium, lineHeight = 18.sp)
    /** 14sp Regular — default body text */
    val body = TextStyle(fontFamily = InterFontFamily, fontSize = 14.sp, fontWeight = FontWeight.Normal, lineHeight = 20.sp)
    /** 14sp Medium (~510) — emphasis body */
    val bodyBold = TextStyle(fontFamily = InterFontFamily, fontSize = 14.sp, fontWeight = FontWeight.Medium, lineHeight = 20.sp)
    /** 13sp Regular — secondary info, captions */
    val caption = TextStyle(fontFamily = InterFontFamily, fontSize = 13.sp, fontWeight = FontWeight.Normal, lineHeight = 18.sp)
    /** 12sp Regular — labels, badges */
    val small = TextStyle(fontFamily = InterFontFamily, fontSize = 12.sp, fontWeight = FontWeight.Normal, lineHeight = 16.sp)
    /** 11sp Medium — tiny labels, timestamps */
    val micro = TextStyle(fontFamily = InterFontFamily, fontSize = 11.sp, fontWeight = FontWeight.Medium, lineHeight = 14.sp)
    /** 10sp Medium — tab labels */
    val tabLabel = TextStyle(fontFamily = InterFontFamily, fontSize = 10.sp, fontWeight = FontWeight.Medium, lineHeight = 12.sp)
}

/**
 * Material 3 Typography mapping for MaterialTheme integration.
 * Maps design tokens to Material 3 type scale slots.
 */
val VostokTypography = Typography(
    headlineLarge = VostokType.heading,
    headlineMedium = VostokType.headline,
    titleLarge = VostokType.heading,
    titleMedium = VostokType.headline,
    titleSmall = VostokType.title,
    bodyLarge = VostokType.body,
    bodyMedium = VostokType.caption,
    bodySmall = VostokType.small,
    labelLarge = VostokType.bodyBold,
    labelMedium = VostokType.caption,
    labelSmall = VostokType.micro,
)
