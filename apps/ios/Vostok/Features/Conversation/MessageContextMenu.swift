import SwiftUI
import UIKit

// MARK: - Quick reactions list

private let quickReactions: [(key: String, emoji: String)] = [
    ("thumbs_up",   "👍"),
    ("heart",       "❤️"),
    ("laugh",       "😂"),
    ("surprised",   "😮"),
    ("sad",         "😢"),
    ("fire",        "🔥"),
    ("party",       "🎉"),
]

// MARK: - Reaction emoji helper (shared)

func reactionEmoji(for key: String) -> String {
    quickReactions.first(where: { $0.key == key })?.emoji ?? key
}

// MARK: - Long-press with visual feedback

/// Adds a shrink effect while pressing and fires the action on long-press completion.
/// Uses `@GestureState` for per-instance press tracking so each bubble has its own state.
struct LongPressContextMenuModifier: ViewModifier {
    let action: () -> Void
    @GestureState private var isLongPressing = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(isLongPressing ? 0.96 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: isLongPressing)
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.5)
                    .updating($isLongPressing) { currentState, gestureState, _ in
                        gestureState = currentState
                    }
                    .onEnded { _ in
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        action()
                    }
            )
    }
}

extension View {
    func longPressContextMenu(action: @escaping () -> Void) -> some View {
        self.modifier(LongPressContextMenuModifier(action: action))
    }
}

// MARK: - Message Action Overlay

/// Full-screen overlay shown on long-press of a message bubble.
/// Displays a floating reaction bar ABOVE the message and an action menu BELOW,
/// matching the Telegram-style context menu design.
struct MessageActionOverlay: View {
    let incoming: Bool
    let messageContent: String
    let messageTimestamp: String
    let isMedia: Bool
    let mediaLabel: String?
    let isPinned: Bool
    let canEdit: Bool
    let onReact:  (String) -> Void
    let onReply:  () -> Void
    let onCopy:   () -> Void
    let onPin:    () -> Void
    let onEdit:   () -> Void
    let onDelete: () -> Void
    let onDismiss: () -> Void

    @State private var appeared = false

    var body: some View {
        ZStack {
            // Blurred + dimmed backdrop
            Rectangle()
                .fill(.ultraThinMaterial)
                .opacity(appeared ? 1 : 0)
                .ignoresSafeArea()
                .onTapGesture { animateDismiss() }

            // Content column
            VStack(spacing: 8) {
                Spacer()

                // ── Reaction bar ──────────────────────────────
                reactionBar
                    .frame(maxWidth: .infinity, alignment: incoming ? .leading : .trailing)
                    .padding(.horizontal, 16)

                // ── Message preview bubble ────────────────────
                messageBubble
                    .frame(maxWidth: .infinity, alignment: incoming ? .leading : .trailing)
                    .padding(.horizontal, 10)

                // ── Action menu ───────────────────────────────
                actionMenu
                    .frame(maxWidth: .infinity, alignment: incoming ? .leading : .trailing)
                    .padding(.horizontal, 16)

                Spacer()
            }
            .opacity(appeared ? 1 : 0)
            .scaleEffect(appeared ? 1 : 0.92)
        }
        .onAppear {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                appeared = true
            }
        }
    }

    // MARK: - Dismiss helpers

    private func animateDismiss() {
        withAnimation(.easeOut(duration: 0.15)) {
            appeared = false
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) {
            onDismiss()
        }
    }

    private func performAction(_ action: @escaping () -> Void) {
        withAnimation(.easeOut(duration: 0.15)) {
            appeared = false
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) {
            onDismiss()
            action()
        }
    }

    // MARK: - Reaction bar

    private var reactionBar: some View {
        HStack(spacing: 2) {
            ForEach(quickReactions, id: \.key) { reaction in
                Button {
                    performAction { onReact(reaction.key) }
                } label: {
                    Text(reaction.emoji)
                        .font(.system(size: 28))
                        .frame(width: 42, height: 42)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(
            Capsule()
                .strokeBorder(Color.white.opacity(0.15), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.18), radius: 12, y: 3)
    }

    // MARK: - Message bubble preview

    private var messageBubble: some View {
        VStack(alignment: .leading, spacing: 4) {
            if isMedia, let label = mediaLabel {
                Text(label)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(incoming ? VostokColors.labelPrimary : .white)
            } else {
                Text(messageContent.isEmpty ? "(encrypted)" : messageContent)
                    .font(.system(size: 17, weight: .regular))
                    .foregroundStyle(incoming ? VostokColors.labelPrimary : .white)
                    .lineLimit(6)
            }

            HStack(spacing: 4) {
                Spacer(minLength: 0)
                Text(messageTimestamp)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(
                        incoming
                            ? VostokColors.labelSecondary
                            : Color.white.opacity(0.7)
                    )
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: 280, alignment: .leading)
        .background(bubbleBackground)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
    }

    @ViewBuilder
    private var bubbleBackground: some View {
        if incoming {
            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(.ultraThinMaterial)
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(VostokColors.glassLight.opacity(0.7))
            }
        } else {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(VostokColors.accent)
        }
    }

    // MARK: - Action menu

    private var actionMenu: some View {
        VStack(spacing: 0) {
            actionRow(label: "Reply", icon: "arrowshape.turn.up.left") {
                performAction { onReply() }
            }
            menuDivider
            actionRow(label: "Copy", icon: "doc.on.doc") {
                performAction { onCopy() }
            }
            menuDivider
            actionRow(
                label: isPinned ? "Unpin" : "Pin",
                icon: isPinned ? "pin.slash" : "pin"
            ) {
                performAction { onPin() }
            }
            if canEdit {
                menuDivider
                actionRow(label: "Edit", icon: "pencil") {
                    performAction { onEdit() }
                }
            }
            menuDivider
            actionRow(label: "Delete", icon: "trash", isDestructive: true) {
                performAction { onDelete() }
            }
        }
        .frame(width: 240)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color(white: 0.5).opacity(0.2), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.18), radius: 12, y: 3)
    }

    private var menuDivider: some View {
        Rectangle()
            .fill(Color(white: 0.5).opacity(0.2))
            .frame(height: 0.5)
            .padding(.leading, 44)
    }

    private func actionRow(
        label: String,
        icon: String,
        isDestructive: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .medium))
                    .frame(width: 24)
                Text(label)
                    .font(.system(size: 16, weight: .regular))
                Spacer()
            }
            .foregroundStyle(isDestructive ? .red : VostokColors.labelPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
