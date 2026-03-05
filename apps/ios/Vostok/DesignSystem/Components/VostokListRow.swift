import SwiftUI

struct VostokListRow: View {
    let title: String
    let subtitle: String
    let subtitleSymbol: String?
    let trailing: String
    let unreadCount: Int
    let isMuted: Bool
    let isPinned: Bool
    let showsReadIndicator: Bool
    let showsSeparator: Bool

    init(
        title: String,
        subtitle: String,
        subtitleSymbol: String? = nil,
        trailing: String,
        unreadCount: Int,
        isMuted: Bool,
        isPinned: Bool = false,
        showsReadIndicator: Bool = false,
        showsSeparator: Bool = true
    ) {
        self.title = title
        self.subtitle = subtitle
        self.subtitleSymbol = subtitleSymbol
        self.trailing = trailing
        self.unreadCount = unreadCount
        self.isMuted = isMuted
        self.isPinned = isPinned
        self.showsReadIndicator = showsReadIndicator
        self.showsSeparator = showsSeparator
    }

    var body: some View {
        HStack(spacing: 0) {
            VostokAvatar(title: title, size: 62)
                .padding(.trailing, 10)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(title)
                        .font(.system(size: 17, weight: .medium))
                        .lineLimit(1)
                    Spacer()
                    HStack(spacing: 2) {
                        if showsReadIndicator {
                            Image(systemName: "checkmark")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(VostokColors.accent)
                        }
                        Text(trailing)
                            .font(.system(size: 14, weight: .regular))
                            .foregroundStyle(VostokColors.labelSecondary)
                    }
                }
                HStack(alignment: .center, spacing: 4) {
                    if let subtitleSymbol {
                        Image(systemName: subtitleSymbol)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(VostokColors.labelSecondary)
                    }
                    Text(subtitle)
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(VostokColors.labelSecondary)
                        .lineLimit(2)
                    if isMuted {
                        Image(systemName: "bell.slash.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(VostokColors.labelSecondary)
                    }
                    Spacer()
                    if unreadCount > 0 {
                        VostokBadge(count: unreadCount, style: isMuted ? .muted : .accent)
                    } else if isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 13, weight: .regular))
                            .foregroundStyle(VostokColors.labelSecondary.opacity(0.75))
                            .rotationEffect(.degrees(12))
                    }
                }
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, 16)
        .frame(maxWidth: .infinity, minHeight: 78, maxHeight: 78, alignment: .leading)
        .background(VostokColors.secondaryBackground)
        .overlay(alignment: .topTrailing) {
            if showsSeparator {
                Rectangle()
                    .fill(VostokColors.separatorVibrant)
                    .frame(height: 0.5)
                    .padding(.leading, 82)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
        .accessibilityHint("Opens conversation")
    }

    private var accessibilitySummary: String {
        var parts: [String] = [title]
        if !subtitle.isEmpty {
            parts.append(subtitle)
        }
        if unreadCount > 0 {
            parts.append("\(unreadCount) unread")
        }
        if isMuted {
            parts.append("Muted")
        }
        if isPinned {
            parts.append("Pinned")
        }
        if !trailing.isEmpty {
            parts.append(trailing)
        }
        return parts.joined(separator: ", ")
    }
}
