import SwiftUI

struct VostokPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(VostokTypography.bodyEmphasized)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 44)
            .padding(.vertical, 8)
            .background(VostokColors.accent.opacity(configuration.isPressed ? 0.8 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct VostokSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(VostokTypography.body)
            .foregroundStyle(VostokColors.controlPrimary)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 44)
            .padding(.vertical, 8)
            .background(VostokColors.secondaryBackground.opacity(configuration.isPressed ? 0.85 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
