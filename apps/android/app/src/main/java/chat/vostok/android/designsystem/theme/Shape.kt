package chat.vostok.android.designsystem.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

/**
 * Vostok shape tokens — source of truth: packages/ui-tokens/src/index.ts
 */
val VostokShapes = Shapes(
    small = RoundedCornerShape(8.dp),   // sm: 8px — small controls, tags
    medium = RoundedCornerShape(14.dp), // md: 14px — cards, surfaces
    large = RoundedCornerShape(20.dp),  // lg: 20px — major surfaces, sheets
    extraLarge = RoundedCornerShape(20.dp), // xl: same as lg
)

/** Pill shape for buttons and avatars (100dp radius). */
val PillShape = RoundedCornerShape(100.dp)
