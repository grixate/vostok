import SwiftUI

struct VostokVoiceBubble: View {
    let duration: String
    let timestamp: String
    let incoming: Bool
    let isEdited: Bool
    let isPinned: Bool
    let reactions: [ReactionDTO]
    let isPlaying: Bool
    let isUnplayed: Bool
    let progress: Double          // 0.0 … 1.0
    let playbackSpeed: Float       // 1.0, 1.5, 2.0
    var onPlayToggle: (() -> Void)?
    var onSeek: ((Double) -> Void)? // value in 0.0…1.0
    var onSpeedChange: (() -> Void)?

    init(
        duration: String,
        timestamp: String,
        incoming: Bool,
        isEdited: Bool = false,
        isPinned: Bool = false,
        reactions: [ReactionDTO] = [],
        isPlaying: Bool = false,
        isUnplayed: Bool = true,
        progress: Double = 0,
        playbackSpeed: Float = 1.0,
        onPlayToggle: (() -> Void)? = nil,
        onSeek: ((Double) -> Void)? = nil,
        onSpeedChange: (() -> Void)? = nil
    ) {
        self.duration = duration
        self.timestamp = timestamp
        self.incoming = incoming
        self.isEdited = isEdited
        self.isPinned = isPinned
        self.reactions = reactions
        self.isPlaying = isPlaying
        self.isUnplayed = isUnplayed
        self.progress = progress
        self.playbackSpeed = playbackSpeed
        self.onPlayToggle = onPlayToggle
        self.onSeek = onSeek
        self.onSpeedChange = onSpeedChange
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
            // Play/pause button + unread dot
            ZStack(alignment: .topTrailing) {
                Button {
                    onPlayToggle?()
                } label: {
                    Circle()
                        .fill(VostokColors.accent)
                        .frame(width: 44, height: 44)
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

                // Unread indicator dot
                if isUnplayed && !isPlaying {
                    Circle()
                        .fill(VostokColors.accent)
                        .frame(width: 8, height: 8)
                        .offset(x: 2, y: -2)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.2), value: isUnplayed)

            VStack(alignment: .leading, spacing: 4) {
                // Seekable waveform
                seekableWaveform

                // Footer row
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
        .padding(.top, (isPlaying || !isUnplayed) ? 22 : 8)
        .padding(.bottom, 8)
        .frame(maxWidth: 312, alignment: .leading)
        .background(incoming ? VostokColors.bubbleIncoming : VostokColors.bubbleOutgoing)
        .clipShape(RoundedRectangle(cornerRadius: VostokTheme.cornerRadiusBubble, style: .continuous))
        // Speed badge overlaid top-right
        .overlay(alignment: .topTrailing) {
            if isPlaying || !isUnplayed {
                Button {
                    onSpeedChange?()
                } label: {
                    Text(speedLabel)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(VostokColors.accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(VostokColors.accent.opacity(0.13), in: Capsule())
                }
                .buttonStyle(.plain)
                .padding(.top, 5)
                .padding(.trailing, 8)
                .accessibilityLabel("Playback speed \(speedLabel)")
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    // MARK: – Seekable waveform

    private var seekableWaveform: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                // Background bars
                HStack(spacing: 2) {
                    ForEach(0..<36, id: \.self) { index in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(VostokColors.accent.opacity(0.25))
                            .frame(width: 2, height: barHeight(index: index))
                    }
                }

                // Played portion overlay
                HStack(spacing: 2) {
                    ForEach(0..<36, id: \.self) { index in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(VostokColors.accent.opacity(0.85))
                            .frame(width: 2, height: barHeight(index: index))
                    }
                }
                .frame(width: geo.size.width * progress, alignment: .leading)
                .clipped()
            }
            .frame(height: 12)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let ratio = max(0, min(1, value.location.x / geo.size.width))
                        onSeek?(Double(ratio))
                    }
            )
        }
        .frame(height: 12)
        .accessibilityHidden(true)
    }

    private func barHeight(index: Int) -> CGFloat {
        CGFloat(index.isMultiple(of: 5) ? 11 : 7)
    }

    // MARK: – Helpers

    private var speedLabel: String {
        switch playbackSpeed {
        case 1.5: return "1.5×"
        case 2.0: return "2×"
        default:  return "1×"
        }
    }

    private func reactionSymbol(for key: String) -> String {
        reactionEmoji(for: key)
    }

    private var accessibilitySummary: String {
        var parts: [String] = []
        parts.append(incoming ? "Incoming voice message" : "Outgoing voice message")
        parts.append("Duration \(duration)")
        if isPlaying { parts.append("Playing") }
        if isEdited  { parts.append("Edited") }
        if isPinned  { parts.append("Pinned") }
        if isUnplayed && !isPlaying { parts.append("Unplayed") }
        if !reactions.isEmpty {
            let reactionsText = reactions
                .map { "\(reactionSymbol(for: $0.reactionKey)) \($0.count)" }
                .joined(separator: ", ")
            parts.append("Reactions: \(reactionsText)")
        }
        if !timestamp.isEmpty { parts.append(timestamp) }
        return parts.joined(separator: ". ")
    }
}
