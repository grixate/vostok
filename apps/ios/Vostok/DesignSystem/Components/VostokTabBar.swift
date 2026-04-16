import SwiftUI
import UIKit

struct VostokTabBarSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .onAppear {
                VostokTabBarAppearance.configure()
            }
    }
}

private enum VostokTabBarAppearance {
    private static var didConfigure = false

    static func configure() {
        guard !didConfigure else { return }
        didConfigure = true

        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(VostokColors.secondaryBackground)
        appearance.shadowColor = .clear
        appearance.shadowImage = UIImage()

        let normal = appearance.stackedLayoutAppearance.normal
        normal.iconColor = UIColor(VostokColors.labelSecondary)
        normal.titleTextAttributes = [
            .foregroundColor: UIColor(VostokColors.labelSecondary),
            .font: VostokTypography.interUIFont(size: 10, weight: .medium)
        ]

        let selected = appearance.stackedLayoutAppearance.selected
        selected.iconColor = UIColor(VostokColors.accent)
        selected.titleTextAttributes = [
            .foregroundColor: UIColor(VostokColors.accent),
            .font: VostokTypography.interUIFont(size: 10, weight: .semibold)
        ]

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
        UITabBar.appearance().tintColor = UIColor(VostokColors.accent)
    }
}

extension View {
    func vostokTabSurface() -> some View {
        modifier(VostokTabBarSurface())
    }
}
