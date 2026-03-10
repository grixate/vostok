import SwiftUI

struct VostokAttachmentBubble: View {
    let filename: String
    let mediaKind: String
    let byteSize: Int?
    let timestamp: String
    let incoming: Bool
    let isEdited: Bool
    let isPinned: Bool
    let reactions: [ReactionDTO]
    var onOpen: (() -> Void)?

    var body: some View {
        HStack {
            if incoming {
                bubble
                Spacer(minLength: 44)
            } else {
                Spacer(minLength: 44)
                bubble
            }
        }
        .padding(.horizontal, 10)
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: mediaIcon)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(VostokColors.accent)
                    .frame(width: 30, height: 30)
                    .background(VostokColors.accent.opacity(0.12))
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(filename)
                        .font(VostokTypography.bodyEmphasized)
                        .foregroundStyle(VostokColors.labelPrimary)
                        .lineLimit(2)

                    Text(detailText)
                        .font(VostokTypography.caption)
                        .foregroundStyle(VostokColors.labelSecondary)
                }
                Spacer(minLength: 0)
            }

            if let onOpen {
                Button("Open", action: onOpen)
                    .buttonStyle(VostokSecondaryButtonStyle())
                    .accessibilityLabel("Open attachment")
                    .accessibilityValue(filename)
            }

            if !reactions.isEmpty {
                HStack(spacing: 4) {
                    ForEach(reactions, id: \.reactionKey) { reaction in
                        HStack(spacing: 3) {
                            Text(reactionSymbol(for: reaction.reactionKey))
                            Text("\(reaction.count)")
                        }
                        .font(VostokTypography.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(VostokColors.accent.opacity(reaction.reacted ? 0.2 : 0.12))
                        .clipShape(Capsule())
                    }
                }
                .foregroundStyle(VostokColors.labelPrimary)
            }

            HStack(spacing: 4) {
                Spacer(minLength: 0)
                if isPinned {
                    Image(systemName: "pin.fill")
                        .font(.system(size: 10, weight: .regular))
                        .foregroundStyle(VostokColors.labelSecondary)
                }
                if isEdited {
                    Text("edited")
                        .font(VostokTypography.caption)
                        .foregroundStyle(VostokColors.labelSecondary)
                }
                Text(timestamp)
                    .font(VostokTypography.caption)
                    .foregroundStyle(VostokColors.labelSecondary)
                if !incoming {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .regular))
                        .foregroundStyle(VostokColors.labelSecondary)
                }
            }
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .frame(maxWidth: 312, alignment: .leading)
        .background(incoming ? VostokColors.bubbleIncoming : VostokColors.bubbleOutgoing)
        .clipShape(RoundedRectangle(cornerRadius: VostokTheme.cornerRadiusBubble, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    private var mediaIcon: String {
        switch mediaKind {
        case "image": return "photo"
        case "audio": return "waveform"
        case "video": return "video"
        default: return "doc"
        }
    }

    private var detailText: String {
        if let byteSize {
            return "\(mediaKind.capitalized) • \(ByteCountFormatter.string(fromByteCount: Int64(byteSize), countStyle: .file))"
        }
        return mediaKind.capitalized
    }

    private func reactionSymbol(for key: String) -> String {
        reactionEmoji(for: key)
    }

    private var accessibilitySummary: String {
        var parts: [String] = []
        parts.append(incoming ? "Incoming attachment" : "Outgoing attachment")
        parts.append(filename)
        parts.append(detailText)
        if isEdited {
            parts.append("Edited")
        }
        if isPinned {
            parts.append("Pinned")
        }
        if !reactions.isEmpty {
            let reactionsText = reactions
                .map { "\(reactionSymbol(for: $0.reactionKey)) \($0.count)" }
                .joined(separator: ", ")
            parts.append("Reactions: \(reactionsText)")
        }
        if !timestamp.isEmpty {
            parts.append(timestamp)
        }
        return parts.joined(separator: ". ")
    }
}
