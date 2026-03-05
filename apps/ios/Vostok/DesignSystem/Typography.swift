import SwiftUI

enum VostokTypography {
    // Keep Telegram-like hierarchy while allowing Dynamic Type scaling.
    static let title = Font.headline.weight(.semibold)
    static let body = Font.body
    static let bodyEmphasized = Font.body.weight(.semibold)
    static let subheadline = Font.subheadline
    static let subheadlineEmphasized = Font.subheadline.weight(.semibold)
    static let footnote = Font.footnote
    static let caption = Font.caption2
}
