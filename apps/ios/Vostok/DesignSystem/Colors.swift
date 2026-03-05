import SwiftUI

enum VostokColors {
    static let accent = Color(hex: "#008BFF")
    static let primaryBackground = Color(hex: "#FFFFFF")
    static let secondaryBackground = Color(hex: "#F2F2F7")
    static let surfaceTertiary = Color(hex: "#EDEDED")
    static let glassLight = Color(hex: "#FFFFFF", alpha: 0.65)
    static let glassDarken = Color(hex: "#F7F7F7")
    static let glassBurn = Color(hex: "#DDDDDD")
    static let chatWallpaperBase = Color(hex: "#92B788")
    static let separatorOpaque = Color(hex: "#C6C6C8")
    static let separatorVibrant = Color(hex: "#E6E6E6")
    static let labelPrimary = Color(hex: "#000000")
    static let labelSecondary = Color(hex: "#3C3C43", alpha: 0.6)
    static let bubbleOutgoing = Color(hex: "#EFFEDD")
    static let bubbleIncoming = Color(hex: "#FFFFFF")
    static let danger = Color(hex: "#FF3B30")
    static let online = Color(hex: "#34C759")
    static let controlPrimary = Color(hex: "#404040")
    static let controlSecondary = Color(hex: "#8C8C8C")
}

private extension Color {
    init(hex: String, alpha: Double = 1.0) {
        let cleaned = hex.replacingOccurrences(of: "#", with: "")
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)

        let r = Double((value >> 16) & 0xFF) / 255.0
        let g = Double((value >> 8) & 0xFF) / 255.0
        let b = Double(value & 0xFF) / 255.0

        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}
