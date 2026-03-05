import SwiftUI

struct VostokVoiceBubble: View {
    let duration: String
    let timestamp: String
    let incoming: Bool
    let isEdited: Bool
    let isPinned: Bool
    let reactions: [ReactionDTO]
    let isPlaying: Bool
    var onPlayToggle: (() -> Void)?

    init(
        duration: String,
        timestamp: String,
        incoming: Bool,
        isEdited: Bool = false,
        isPinned: Bool = false,
        reactions: [ReactionDTO] = [],
        isPlaying: Bool = false,
        onPlayToggle: (() -> Void)? = nil
    ) {
        self.duration = duration
        self.timestamp = timestamp
        self.incoming = incoming
        self.isEdited = isEdited
        self.isPinned = isPinned
        self.reactions = reactions
        self.isPlaying = isPlaying
        self.onPlayToggle = onPlayToggle
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
        HStack(spacing: 8) {
            Button {
                onPlayToggle?()
            } label: {
                Circle()
                    .fill(VostokColors.accent)
                    .frame(width: 42, height: 42)
                    .overlay {
                        Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .offset(x: isPlaying ? 0 : 1)
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isPlaying ? "Pause voice message" : "Play voice message")
            .accessibilityHint("Toggles playback")

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 2) {
                    ForEach(0..<36, id: \.self) { index in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(VostokColors.accent.opacity(0.58))
                            .frame(width: 2, height: index.isMultiple(of: 5) ? 11 : 7)
                    }
                }
                .frame(height: 12)
                .accessibilityHidden(true)

                HStack(spacing: 4) {
                    Text(duration)
                        .font(VostokTypography.caption)
                    Circle()
                        .fill(VostokColors.labelSecondary)
                        .frame(width: 3, height: 3)
                    Spacer(minLength: 0)
                    if isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 10, weight: .regular))
                    }
                    if isEdited {
                        Text("edited")
                            .font(VostokTypography.caption)
                    }
                    Text(timestamp)
                        .font(VostokTypography.caption)
                }
                .foregroundStyle(VostokColors.labelSecondary)

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
            }
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 8)
        .frame(maxWidth: 312, alignment: .leading)
        .background(incoming ? VostokColors.bubbleIncoming : VostokColors.bubbleOutgoing)
        .clipShape(RoundedRectangle(cornerRadius: VostokTheme.cornerRadiusBubble, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
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
        parts.append(incoming ? "Incoming voice message" : "Outgoing voice message")
        parts.append("Duration \(duration)")
        if isPlaying {
            parts.append("Playing")
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
