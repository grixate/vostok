import SwiftUI

/// Primary CTA button — full-width, fixed 50pt height, 12pt radius, accent fill.
/// Use for the main action on any screen (auth submit, confirm, etc.).
struct VostokPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(VostokTypography.bodyEmphasis)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(VostokColors.accent.opacity(configuration.isPressed ? 0.8 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// Secondary / ghost button — same proportions as primary but uses secondary background.
struct VostokSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(VostokTypography.body)
            .foregroundStyle(VostokColors.labelSecondary)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(VostokColors.secondaryBackground.opacity(configuration.isPressed ? 0.85 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// Pill-shaped action button — Capsule (≈1000pt radius) per spec §5.2.
/// Use for floating actions, call buttons, and non-auth contextual actions.
struct VostokPillButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(VostokTypography.bodyEmphasis)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(VostokColors.accent.opacity(configuration.isPressed ? 0.8 : 1))
            .clipShape(Capsule())
    }
}
