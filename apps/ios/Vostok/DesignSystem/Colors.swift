import SwiftUI
import UIKit

enum VostokColors {
    // MARK: – Backgrounds (adaptive light/dark)
    // Source of truth: packages/ui-tokens/src/index.ts
    static let primaryBackground   = Color(adaptiveLight: "#EAEAEA",  dark: "#090909")
    static let secondaryBackground = Color(adaptiveLight: "#FFFFFF",  dark: "#111111")
    static let tertiaryBackground  = Color(adaptiveLight: "#F5F5F5",  dark: "#1A1A1A")

    // MARK: – Fills
    /// Hover / selected state surface
    static let fillHover     = Color(adaptiveLight: "#EFEFEF", dark: "#1C1C1C")
    /// Active state surface
    static let fillActive    = Color(adaptiveLight: "#E3E3E3", dark: "#2A2A2A")
    /// Input field background
    static let fillInput     = Color(adaptiveLight: "#F5F5F5", dark: "#1A1A1A")
    /// Generic overlay fill
    static let fill = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(white: 1, alpha: 0.06)
            : UIColor(white: 0, alpha: 0.04)
    })

    // MARK: – Chat surfaces
    /// Outgoing message bubble — peach (light) / warm brown (dark)
    static let bubbleOutgoing = Color(adaptiveLight: "#FFE5CC", dark: "#201B13")
    /// Incoming message bubble
    static let bubbleIncoming = Color(adaptiveLight: "#EFEFEF",  dark: "#1C1C1C")
    /// Date-separator / service message overlay
    static let bubbleSystem = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(white: 0, alpha: 0.30)
            : UIColor(white: 1, alpha: 0.50)
    })

    // MARK: – Separators
    static let separator = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(white: 1, alpha: 0.035)
            : UIColor(white: 0, alpha: 0.08)
    })
    static let separatorOpaque = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(white: 1, alpha: 0.02)
            : UIColor(white: 0, alpha: 0.04)
    })

    // MARK: – Labels (adaptive)
    static let labelPrimary = Color(adaptiveLight: "#111111", dark: "#FFFFFF")
    static let labelSecondary = Color(adaptiveLight: "#666666", dark: "#888888")
    static let labelTertiary = Color(adaptiveLight: "#999999", dark: "#555555")

    // MARK: – Accent / brand (orange)
    static let accent      = Color(hex: "#FF5500")
    static let accentAlt   = Color(hex: "#FF9500")
    static let accentAmber = Color(hex: "#FFB347")
    static let accentHover = Color(hex: "#E64D00")
    static let accentSoft  = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 1, green: 85/255, blue: 0, alpha: 0.15)
            : UIColor(red: 1, green: 85/255, blue: 0, alpha: 0.10)
    })
    static let textAccent    = Color(hex: "#FF5500")
    static let textOnAccent  = Color.white

    // MARK: – State
    static let danger  = Color(adaptiveLight: "#D32F2F", dark: "#E53935")
    static let success = Color(adaptiveLight: "#2DA44E", dark: "#34C759")
    static let online  = Color(hex: "#44CF6C")

    // MARK: – Peer avatar colors (8-color palette, deterministic by name hash)
    static let peerColors: [Color] = [
        Color(hex: "#FF5C5C"),
        Color(hex: "#4FAE4E"),
        Color(hex: "#E6A817"),
        Color(hex: "#009EE6"),
        Color(hex: "#7B68EE"),
        Color(hex: "#E667AF"),
        Color(hex: "#20BFAB"),
        Color(hex: "#EB7840"),
    ]

    /// Returns a deterministic peer color based on a string (name, chat ID, etc.)
    static func peerColor(for name: String) -> Color {
        guard !name.isEmpty else { return peerColors[0] }
        let hash = name.utf8.reduce(0) { ($0 &+ UInt32($1)) &* 31 }
        return peerColors[Int(hash % UInt32(peerColors.count))]
    }

    // MARK: – Deprecated aliases (kept for call-site compatibility during migration)
    /// Deprecated — use `labelSecondary`
    static var controlPrimary: Color { labelSecondary }
    /// Deprecated — use `labelTertiary`
    static var controlSecondary: Color { labelTertiary }
    /// Deprecated — use `tertiaryBackground`
    static var fillTertiary: Color { tertiaryBackground }
    /// Deprecated — use `fill`
    static var fillPrimary: Color { fill }
    /// Deprecated — use `fill`
    static var fillSecondary: Color { fill }
    /// Deprecated — use `secondaryBackground`
    static var surfaceTertiary: Color { tertiaryBackground }
    /// Deprecated — use `accentSoft`
    static var accentMuted: Color { accentSoft }
    /// Deprecated — use `separator`
    static var separatorVibrant: Color { separator }
    /// Deprecated — use `fillInput`
    static var glassLight: Color { fillInput }
    static var glassDarken: Color { tertiaryBackground }
    static var glassBurn: Color { tertiaryBackground }
}

// MARK: – Color helpers

extension Color {
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
