import SwiftUI

struct VostokTheme {
    // MARK: – Corner radii
    static let cornerRadiusCard:   CGFloat = 10
    /// Spec: 17px  (was 18 — corrected to match design language §5.2)
    static let cornerRadiusBubble: CGFloat = 17

    // MARK: – Spacing — 4 px grid (§5.1: 2 / 4 / 8 / 10 / 16 / 24 / 32)
    static let spaceXS:  CGFloat = 2    // micro gaps, icon badges
    static let spaceSM:  CGFloat = 4    // dense inline gaps
    static let spaceMD:  CGFloat = 8    // standard tight gap
    static let spaceLG:  CGFloat = 10   // avatar → content gap
    static let spaceXL:  CGFloat = 16   // horizontal screen margin
    static let space2XL: CGFloat = 24   // between sections
    static let space3XL: CGFloat = 32   // major vertical separation

    // MARK: – Deprecated spacing aliases (kept until call sites migrate)
    /// Deprecated — use `spaceMD` (8)
    static var spacingTight:   CGFloat { spaceMD }
    /// Deprecated — use `spaceXL` (16) — was 12, which is off the 4px grid
    static var spacingCompact: CGFloat { spaceXL }
    /// Deprecated — use `spaceXL` (16)
    static var spacingRegular: CGFloat { spaceXL }
}
