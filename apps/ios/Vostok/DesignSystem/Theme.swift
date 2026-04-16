import SwiftUI

struct VostokTheme {
    // MARK: – Corner radii (matches packages/ui-tokens/src/index.ts)
    static let radiusSM:   CGFloat = 8     // small controls, tags
    static let radiusMD:   CGFloat = 14    // cards, surfaces
    static let radiusLG:   CGFloat = 20    // major surfaces, sheets
    static let radiusPill: CGFloat = 100   // pill buttons, avatars

    // MARK: – Spacing (matches packages/ui-tokens/src/index.ts)
    static let spaceXS:  CGFloat = 4     // micro gaps
    static let spaceSM:  CGFloat = 8     // tight gaps
    static let spaceMD:  CGFloat = 12    // standard gap
    static let spaceLG:  CGFloat = 16    // comfortable gap
    static let spaceXL:  CGFloat = 24    // between sections
    static let spaceXXL: CGFloat = 32    // major separation

    // MARK: – Viewport dimensions (matches packages/ui-tokens/src/index.ts)
    static let chatRowHeight:    CGFloat = 72
    static let avatarList:       CGFloat = 48
    static let avatarHeader:     CGFloat = 40
    static let avatarMessage:    CGFloat = 34
    static let avatarCompact:    CGFloat = 32
    static let settingsRowHeight: CGFloat = 52

    // MARK: – Motion durations
    static let motionFast: Double = 0.1   // 100ms — toggles, small interactions
    static let motionBase: Double = 0.15  // 150ms — default transitions
    static let motionSlow: Double = 0.2   // 200ms — sheet/modal presentations

    // MARK: – Deprecated aliases (kept for call-site compatibility)
    /// Deprecated — use `radiusMD`
    static var cornerRadiusCard: CGFloat { radiusMD }
    /// Deprecated — use `radiusLG`
    static var cornerRadiusBubble: CGFloat { radiusLG }
    /// Deprecated — use `spaceSM`
    static var spacingTight: CGFloat { spaceSM }
    /// Deprecated — use `spaceLG`
    static var spacingCompact: CGFloat { spaceLG }
    /// Deprecated — use `spaceLG`
    static var spacingRegular: CGFloat { spaceLG }
    /// Deprecated — use `spaceXL`
    static var space2XL: CGFloat { spaceXL }
    /// Deprecated — use `spaceXXL`
    static var space3XL: CGFloat { spaceXXL }
}
