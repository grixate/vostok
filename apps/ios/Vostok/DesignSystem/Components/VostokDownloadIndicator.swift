import SwiftUI

/// Download arrow overlay + circular progress ring for media attachments.
/// Shows different states: idle (download arrow), downloading (progress ring),
/// decrypting (spinner), ready (checkmark), error (retry arrow).
struct VostokDownloadIndicator: View {
    let state: DownloadManager.DownloadState
    let size: CGFloat
    var onTap: (() -> Void)?

    init(state: DownloadManager.DownloadState, size: CGFloat = 44, onTap: (() -> Void)? = nil) {
        self.state = state
        self.size = size
        self.onTap = onTap
    }

    var body: some View {
        Button {
            onTap?()
        } label: {
            ZStack {
                // Background circle
                Circle()
                    .fill(Color.black.opacity(0.45))
                    .frame(width: size, height: size)

                switch state {
                case .idle, .autoQueued:
                    // Download arrow
                    Image(systemName: "arrow.down.circle")
                        .font(.system(size: size * 0.55, weight: .medium))
                        .foregroundStyle(.white)

                case .downloading(let progress):
                    // Progress ring
                    ZStack {
                        Circle()
                            .stroke(Color.white.opacity(0.3), lineWidth: 2.5)
                            .frame(width: size * 0.7, height: size * 0.7)
                        Circle()
                            .trim(from: 0, to: progress)
                            .stroke(Color.white, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                            .frame(width: size * 0.7, height: size * 0.7)
                            .rotationEffect(.degrees(-90))
                            .animation(.linear(duration: 0.1), value: progress)

                        // Cancel X
                        Image(systemName: "xmark")
                            .font(.system(size: size * 0.25, weight: .bold))
                            .foregroundStyle(.white)
                    }

                case .decrypting:
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        .scaleEffect(size * 0.02)

                case .ready:
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: size * 0.55, weight: .medium))
                        .foregroundStyle(VostokColors.online)

                case .error:
                    Image(systemName: "arrow.clockwise.circle")
                        .font(.system(size: size * 0.55, weight: .medium))
                        .foregroundStyle(VostokColors.danger)

                case .expired:
                    Image(systemName: "clock.badge.xmark")
                        .font(.system(size: size * 0.45, weight: .medium))
                        .foregroundStyle(VostokColors.labelTertiary)

                case .cancelled:
                    Image(systemName: "arrow.down.circle")
                        .font(.system(size: size * 0.55, weight: .medium))
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(state == .ready || state == .expired)
    }
}

/// Compact inline download status text for list rows.
struct VostokDownloadStatusText: View {
    let state: DownloadManager.DownloadState

    var body: some View {
        switch state {
        case .idle:
            EmptyView()
        case .autoQueued:
            Text(L10n.t("waiting"))
                .font(VostokTypography.small)
                .foregroundStyle(VostokColors.labelTertiary)
        case .downloading(let progress):
            Text("\(Int(progress * 100))%")
                .font(VostokTypography.small)
                .foregroundStyle(VostokColors.accent)
        case .decrypting:
            Text(L10n.t("loading"))
                .font(VostokTypography.small)
                .foregroundStyle(VostokColors.accent)
        case .ready:
            Text(L10n.t("downloaded"))
                .font(VostokTypography.small)
                .foregroundStyle(VostokColors.online)
        case .error(let message):
            Text(message)
                .font(VostokTypography.small)
                .foregroundStyle(VostokColors.danger)
                .lineLimit(1)
        case .expired:
            Text(L10n.t("media_expired"))
                .font(VostokTypography.small)
                .foregroundStyle(VostokColors.labelTertiary)
        case .cancelled:
            EmptyView()
        }
    }
}
