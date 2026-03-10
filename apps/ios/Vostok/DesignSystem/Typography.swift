import SwiftUI

/// Fixed-size typography scale matching the Vostok design language (§4.1).
/// Sizes are absolute points and do **not** scale with Dynamic Type,
/// preserving pixel-accurate layout in message bubbles and tab bars.
enum VostokTypography {
    // MARK: – Display / navigation
    /// 34px Bold — large navigation titles
    static let titleLarge = Font.system(size: 34, weight: .bold)
    /// 22px Semibold — auth screen / section headings
    static let titleSection = Font.system(size: 22, weight: .semibold)
    /// 17px Semibold — screen titles, section headers
    static let title = Font.system(size: 17, weight: .semibold)

    // MARK: – Body
    /// 17px Regular — message text, descriptions
    static let body = Font.system(size: 17, weight: .regular)
    /// 17px Medium — chat / contact names  (weight 510 ≈ .medium)
    static let bodyEmphasis = Font.system(size: 17, weight: .medium)
    /// Deprecated alias — use `bodyEmphasis`
    static var bodyEmphasized: Font { bodyEmphasis }

    // MARK: – Subheadline
    /// 15px Regular — message previews, secondary labels
    static let subheadline = Font.system(size: 15, weight: .regular)
    /// 15px Medium — muted badge counts, emphasis in lists
    static let subheadlineEmphasis = Font.system(size: 15, weight: .medium)
    /// Deprecated alias — use `subheadlineEmphasis`
    static var subheadlineEmphasized: Font { subheadlineEmphasis }

    // MARK: – Small
    /// 13px Regular — metadata, timestamps in lists
    static let footnote = Font.system(size: 13, weight: .regular)
    /// 12px Regular — bubble timestamps, captions (was .caption2 = 11pt — now correct)
    static let caption = Font.system(size: 12, weight: .regular)
    /// 10px Medium — tab bar labels
    static let tabLabel = Font.system(size: 10, weight: .medium)
}
