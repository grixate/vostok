import SwiftUI

struct VostokBadge: View {
    enum Style {
        case accent   // blue fill, white text — unread / active
        case muted    // light gray fill, primary text — silenced / muted
    }

    let count: Int
    let style: Style

    init(count: Int, style: Style = .accent) {
        self.count = count
        self.style = style
    }

    var body: some View {
        if count > 0 {
            Text("\(count)")
                .font(VostokTypography.subheadlineEmphasis)   // spec §6.1: 15px Medium
                .foregroundStyle(style == .accent ? .white : VostokColors.labelPrimary)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(style == .accent ? VostokColors.accent : VostokColors.fillSecondary)
                .clipShape(Capsule())
                .accessibilityLabel("\(count) unread")
        }
    }
}
