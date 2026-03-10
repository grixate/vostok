import SwiftUI
import AVFoundation
import UIKit

// MARK: - Video Player Layer View (UIKit)

struct CircularVideoPlayer: UIViewRepresentable {
    let player: AVPlayer

    func makeUIView(context: Context) -> PlayerLayerView {
        PlayerLayerView(player: player)
    }

    func updateUIView(_ uiView: PlayerLayerView, context: Context) {}

    final class PlayerLayerView: UIView {
        private let playerLayer = AVPlayerLayer()

        init(player: AVPlayer) {
            super.init(frame: .zero)
            backgroundColor = .black
            playerLayer.player = player
            playerLayer.videoGravity = .resizeAspectFill
            layer.addSublayer(playerLayer)
        }

        required init?(coder: NSCoder) { fatalError() }

        override func layoutSubviews() {
            super.layoutSubviews()
            playerLayer.frame = bounds
        }
    }
}

// MARK: - Round Video Bubble

struct VostokRoundVideoBubble: View {
    let filename: String
    let timestamp: String
    let incoming: Bool
    let reactions: [ReactionDTO]
    // Provided by ConversationView's player manager
    let isActive: Bool          // this video is currently loaded/playing
    let isPlaying: Bool
    let isMuted: Bool
    let progress: Double        // 0…1
    let duration: String        // "0:12"
    var player: AVPlayer?       // nil = not yet loaded
    var onTap: () -> Void       // toggle play / load
    var onMuteTap: () -> Void   // toggle mute

    private static let diameter: CGFloat = 220

    var body: some View {
        HStack {
            if incoming {
                content
                Spacer(minLength: 44)
            } else {
                Spacer(minLength: 44)
                content
            }
        }
        .padding(.horizontal, 10)
    }

    private var content: some View {
        VStack(alignment: incoming ? .leading : .trailing, spacing: 6) {
            circle
            if !reactions.isEmpty { reactionRow }
            timestampLabel
        }
    }

    // MARK: - Circle

    private var circle: some View {
        ZStack {
            // Background
            Circle()
                .fill(Color.black)
                .frame(width: Self.diameter, height: Self.diameter)

            // Video layer (when loaded)
            if let player, isActive {
                CircularVideoPlayer(player: player)
                    .frame(width: Self.diameter, height: Self.diameter)
                    .clipShape(Circle())
            }

            // Play overlay (when not playing)
            if !isPlaying {
                Circle()
                    .fill(Color.black.opacity(isActive ? 0.30 : 0.55))
                    .frame(width: 56, height: 56)
                    .overlay {
                        Image(systemName: "play.fill")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(.white)
                            .offset(x: 2)
                    }
            }

            // Muted badge (top-right when playing muted)
            if isPlaying && isMuted {
                VStack {
                    HStack {
                        Spacer()
                        Image(systemName: "speaker.slash.fill")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.white)
                            .padding(5)
                            .background(Color.black.opacity(0.55), in: Circle())
                            .padding(10)
                    }
                    Spacer()
                }
                .frame(width: Self.diameter, height: Self.diameter)
            }

            // Duration pill at bottom
            VStack {
                Spacer()
                Text(duration)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.black.opacity(0.55), in: Capsule())
                    .padding(.bottom, 14)
            }
            .frame(width: Self.diameter, height: Self.diameter)
        }
        // Progress ring
        .overlay {
            Circle()
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 2)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(VostokColors.accent, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.1), value: progress)
        }
        .contentShape(Circle())
        .onTapGesture {
            if isActive && isPlaying {
                onMuteTap()
            } else {
                onTap()
            }
        }
        .accessibilityLabel(incoming ? "Incoming video message" : "Outgoing video message")
        .accessibilityHint(isPlaying ? "Tap to mute or unmute" : "Tap to play")
    }

    // MARK: - Reactions

    private var reactionRow: some View {
        HStack(spacing: 4) {
            ForEach(reactions, id: \.reactionKey) { reaction in
                HStack(spacing: 3) {
                    Text(reactionEmoji(for: reaction.reactionKey))
                    Text("\(reaction.count)")
                }
                .font(.caption)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(VostokColors.accent.opacity(reaction.reacted ? 0.2 : 0.12))
                .clipShape(Capsule())
            }
        }
        .foregroundStyle(VostokColors.labelPrimary)
    }

    private var timestampLabel: some View {
        Text(timestamp)
            .font(VostokTypography.caption)
            .foregroundStyle(VostokColors.labelSecondary)
    }
}
