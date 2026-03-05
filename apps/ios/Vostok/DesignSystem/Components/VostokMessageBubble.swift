import SwiftUI

struct VostokMessageBubble: View {
    let text: String
    let timestamp: String
    let incoming: Bool
    let isEdited: Bool
    let isPinned: Bool
    let reactions: [ReactionDTO]
    let replyPreview: String?
    var onReplyTap: (() -> Void)?

    init(
        text: String,
        timestamp: String,
        incoming: Bool,
        isEdited: Bool = false,
        isPinned: Bool = false,
        reactions: [ReactionDTO] = [],
        replyPreview: String? = nil,
        onReplyTap: (() -> Void)? = nil
    ) {
        self.text = text
        self.timestamp = timestamp
        self.incoming = incoming
        self.isEdited = isEdited
        self.isPinned = isPinned
        self.reactions = reactions
        self.replyPreview = replyPreview
        self.onReplyTap = onReplyTap
    }

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
        VStack(alignment: .leading, spacing: 4) {
            if let replyPreview {
                Group {
                    if let onReplyTap {
                        Button(action: onReplyTap) {
                            replyPreviewView(replyPreview)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Replied message")
                        .accessibilityValue(replyPreview)
                        .accessibilityHint("Jumps to the original message")
                    } else {
                        replyPreviewView(replyPreview)
                    }
                }
            }

            Text(text)
                .font(VostokTypography.body)
                .foregroundStyle(VostokColors.labelPrimary)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: 290, alignment: .leading)

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
        .padding(.vertical, 5)
        .frame(maxWidth: 312, alignment: .leading)
        .background(incoming ? VostokColors.bubbleIncoming : VostokColors.bubbleOutgoing)
        .clipShape(RoundedRectangle(cornerRadius: VostokTheme.cornerRadiusBubble, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    private func replyPreviewView(_ preview: String) -> some View {
        HStack(spacing: 6) {
            Rectangle()
                .fill(VostokColors.accent)
                .frame(width: 3, height: 28)
                .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))
            Text(preview)
                .font(VostokTypography.footnote)
                .foregroundStyle(VostokColors.labelSecondary)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(VostokColors.accent.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private func reactionSymbol(for key: String) -> String {
        switch key {
        case "thumbs_up": return "👍"
        case "heart": return "❤️"
        case "laugh": return "😂"
        case "fire": return "🔥"
        default: return key
        }
    }

    private var accessibilitySummary: String {
        var parts: [String] = []
        parts.append(incoming ? "Incoming message" : "Outgoing message")
        parts.append(text)
        if let replyPreview {
            parts.append("Reply: \(replyPreview)")
        }
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
