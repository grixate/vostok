import SwiftUI
import UIKit

enum VostokColors {
    // MARK: – Backgrounds (adaptive light/dark)
    static let primaryBackground   = Color(adaptiveLight: "#FFFFFF",  dark: "#1C1C1E")
    static let secondaryBackground = Color(adaptiveLight: "#F2F2F7",  dark: "#2C2C2E")

    // MARK: – Fills
    /// Selected-tab fill / input surface (was `surfaceTertiary`)
    static let fillTertiary  = Color(adaptiveLight: "#EDEDED", dark: "#333333")
    /// Chip / toggle track overlay — rgba(120,120,128,0.20)
    static let fillPrimary   = Color(red: 120/255, green: 120/255, blue: 128/255, opacity: 0.2)
    /// Muted-badge background — rgba(120,120,128,0.16)
    static let fillSecondary = Color(red: 120/255, green: 120/255, blue: 128/255, opacity: 0.16)
    /// Deprecated alias — prefer `fillTertiary`
    static var surfaceTertiary: Color { fillTertiary }

    // MARK: – Glass / surface overlays
    static let glassLight  = Color(hex: "#FFFFFF", alpha: 0.65)
    static let glassDarken = Color(hex: "#F7F7F7")
    static let glassBurn   = Color(hex: "#DDDDDD")

    // MARK: – Chat surfaces
    /// Chat wallpaper background — spec #DCE8D4 (was #92B788 — too dark)
    static let chatWallpaperBase = Color(hex: "#DCE8D4")
    /// Outgoing message bubble — spec #E1FEC6 light / #3B6E2B dark (was #EFFEDD)
    static let bubbleOutgoing = Color(adaptiveLight: "#E1FEC6", dark: "#3B6E2B")
    /// Incoming message bubble (adaptive)
    static let bubbleIncoming = Color(adaptiveLight: "#FFFFFF",  dark: "#2C2C2E")
    /// Date-separator / service message overlay
    static let bubbleService  = Color.black.opacity(0.3)

    // MARK: – Separators
    static let separatorOpaque  = Color(hex: "#C6C6C8")
    static let separatorVibrant = Color(adaptiveLight: "#E6E6E6", dark: "#38383A")

    // MARK: – Labels (adaptive)
    static let labelPrimary   = Color(adaptiveLight: "#000000", dark: "#FFFFFF")
    /// rgba(60,60,67,0.6) light / rgba(235,235,245,0.6) dark
    static let labelSecondary = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 235/255, green: 235/255, blue: 245/255, alpha: 0.6)
            : UIColor(red:  60/255, green:  60/255, blue:  67/255, alpha: 0.6)
    })
    /// Placeholder / disabled text — rgba(60,60,67,0.30)
    static let labelTertiary  = Color(red: 60/255, green: 60/255, blue: 67/255, opacity: 0.3)

    // MARK: – Accent / brand
    static let accent      = Color(hex: "#008BFF")
    static let accentMuted = Color(hex: "#008BFF", alpha: 0.12)   // badge highlight

    // MARK: – State
    static let danger = Color(hex: "#FF3B30")
    static let online = Color(hex: "#34C759")

    // MARK: – Deprecated (non-spec tokens — kept for call-site compatibility)
    /// Deprecated — use `labelSecondary` for secondary text / icons
    static var controlPrimary: Color   { labelSecondary }
    /// Deprecated — use `labelTertiary` for tertiary text / icons
    static var controlSecondary: Color { labelTertiary }
}

// MARK: – Private Color helpers

private extension Color {
    /// Hex + alpha initialiser (fixed / light-mode colour).
    init(hex: String, alpha: Double = 1.0) {
        let cleaned = hex.replacingOccurrences(of: "#", with: "")
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        let r = Double((value >> 16) & 0xFF) / 255.0
        let g = Double((value >> 8)  & 0xFF) / 255.0
        let b = Double( value        & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }

    /// Adaptive colour that resolves to different hex values in light vs dark mode.
    init(adaptiveLight lightHex: String, dark darkHex: String, alpha: Double = 1.0) {
        self = Color(uiColor: UIColor { traits in
            let hex     = traits.userInterfaceStyle == .dark ? darkHex : lightHex
            let cleaned = hex.replacingOccurrences(of: "#", with: "")
            var value: UInt64 = 0
            Scanner(string: cleaned).scanHexInt64(&value)
            let r = CGFloat((value >> 16) & 0xFF) / 255.0
            let g = CGFloat((value >> 8)  & 0xFF) / 255.0
            let b = CGFloat( value        & 0xFF) / 255.0
            return UIColor(red: r, green: g, blue: b, alpha: CGFloat(alpha))
        })
    }
}
