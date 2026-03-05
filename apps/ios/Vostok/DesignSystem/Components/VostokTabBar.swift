import SwiftUI
import UIKit

struct VostokTabBarSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .onAppear {
                VostokTabBarAppearance.configure()
            }
            .toolbarBackground(.ultraThinMaterial, for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
    }
}

private enum VostokTabBarAppearance {
    private static var didConfigure = false

    static func configure() {
        guard !didConfigure else { return }
        didConfigure = true

        let appearance = UITabBarAppearance()
        appearance.configureWithTransparentBackground()
        appearance.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterialLight)
        appearance.backgroundColor = UIColor.white.withAlphaComponent(0.65)
        appearance.shadowColor = .clear

        let normal = appearance.stackedLayoutAppearance.normal
        normal.iconColor = UIColor(VostokColors.controlPrimary)
        normal.titleTextAttributes = [
            .foregroundColor: UIColor(VostokColors.controlPrimary),
            .font: UIFont.systemFont(ofSize: 10, weight: .medium)
        ]

        let selected = appearance.stackedLayoutAppearance.selected
        selected.iconColor = UIColor(VostokColors.accent)
        selected.titleTextAttributes = [
            .foregroundColor: UIColor(VostokColors.accent),
            .font: UIFont.systemFont(ofSize: 10, weight: .semibold)
        ]

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }
}

extension View {
    func vostokTabSurface() -> some View {
        modifier(VostokTabBarSurface())
    }
}
