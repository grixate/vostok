import SwiftUI

struct VostokBadge: View {
    enum Style {
        case accent
        case muted
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
                .font(VostokTypography.footnote)
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(style == .accent ? VostokColors.accent : VostokColors.controlPrimary)
                .clipShape(Capsule())
                .accessibilityLabel("\(count) unread")
        }
    }
}
