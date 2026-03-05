import SwiftUI

struct VostokAvatar: View {
    let title: String
    let size: CGFloat
    let isOnline: Bool

    init(title: String, size: CGFloat = 48, isOnline: Bool = false) {
        self.title = title
        self.size = size
        self.isOnline = isOnline
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Circle()
                .fill(VostokColors.secondaryBackground)
                .frame(width: size, height: size)
                .overlay(
                    Text(String(title.prefix(1)).uppercased())
                        .font(VostokTypography.bodyEmphasized)
                        .foregroundStyle(VostokColors.controlPrimary)
                )

            if isOnline {
                Circle()
                    .fill(VostokColors.online)
                    .frame(width: max(8, size * 0.22), height: max(8, size * 0.22))
                    .overlay(Circle().stroke(.white, lineWidth: 1.5))
                    .offset(x: 1, y: 1)
            }
        }
    }
}
