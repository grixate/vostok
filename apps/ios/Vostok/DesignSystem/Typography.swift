import SwiftUI
import UIKit

/// Typography scale matching the Vostok design tokens (packages/ui-tokens/src/index.ts).
/// Uses the Inter font family bundled with the app.
/// Sizes are absolute points and do **not** scale with Dynamic Type,
/// preserving pixel-accurate layout in message bubbles and tab bars.
enum VostokTypography {
    // MARK: – Token-aligned scale (matches web tokens exactly)

    /// 22px Bold (700) — main section titles, auth headers
    static let heading = interFont(size: 22, weight: .bold)

    /// 16px SemiBold (600) — subsection titles
    static let headline = interFont(size: 16, weight: .semibold)

    /// 15px Medium (≈510) — row titles, list items
    static let title = interFont(size: 15, weight: .medium)

    /// 14px Regular (400) — default body text
    static let body = interFont(size: 14, weight: .regular)

    /// 14px Medium (≈510) — emphasis body text
    static let bodyBold = interFont(size: 14, weight: .medium)

    /// 13px Regular (400) — secondary info, captions
    static let caption = interFont(size: 13, weight: .regular)

    /// 12px Regular (400) — labels, badges
    static let small = interFont(size: 12, weight: .regular)

    /// 11px Medium (≈510) — tiny labels, timestamps
    static let micro = interFont(size: 11, weight: .medium)

    // MARK: – iOS-specific additions (for navigation and system contexts)

    /// 34px Bold — large navigation titles
    static let titleLarge = interFont(size: 34, weight: .bold)

    /// 10px Medium — tab bar labels
    static let tabLabel = interFont(size: 10, weight: .medium)

    // MARK: – Deprecated aliases (map old names to new token names)

    /// Deprecated — use `heading`
    static var titleSection: Font { heading }
    /// Deprecated — use `bodyBold`
    static var bodyEmphasis: Font { bodyBold }
    /// Deprecated — use `bodyBold`
    static var bodyEmphasized: Font { bodyBold }
    /// Deprecated — use `title`
    static var subheadline: Font { title }
    /// Deprecated — use `title`
    static var subheadlineEmphasis: Font { title }
    /// Deprecated — use `title`
    static var subheadlineEmphasized: Font { title }
    /// Deprecated — use `caption`
    static var footnote: Font { caption }

    // MARK: – UIFont equivalents (for UIKit contexts like tab bar appearance)

    static func interUIFont(size: CGFloat, weight: UIFont.Weight) -> UIFont {
        let name: String
        switch weight {
        case .bold:     name = "Inter-Bold"
        case .semibold: name = "Inter-SemiBold"
        case .medium:   name = "Inter-Medium"
        default:        name = "Inter-Regular"
        }
        return UIFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: weight)
    }

    // MARK: – Private

    private static func interFont(size: CGFloat, weight: Font.Weight) -> Font {
        let name: String
        switch weight {
        case .bold:     name = "Inter-Bold"
        case .semibold: name = "Inter-SemiBold"
        case .medium:   name = "Inter-Medium"
        default:        name = "Inter-Regular"
        }
        return .custom(name, fixedSize: size)
    }
}
