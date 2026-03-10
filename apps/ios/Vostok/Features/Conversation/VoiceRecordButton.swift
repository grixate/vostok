import SwiftUI

/// A mic/video button that activates recording via a long-press (≥ 200 ms) hold gesture.
/// Short tap (< 200 ms) toggles between voice and video recording modes.
/// Drag gestures while held are forwarded to `onDragChanged` / `onEndRecording` so the
/// parent can implement slide-to-cancel and slide-to-lock behaviours.
struct VoiceRecordButton: View {
    @Binding var isVideoMode: Bool
    let onStartRecording: () -> Void
    let onEndRecording: () -> Void
    let onDragChanged: (CGSize) -> Void

    @State private var isHeld = false
    @State private var longPressTriggered = false
    @State private var holdTask: Task<Void, Never>?

    var body: some View {
        Image(systemName: isVideoMode ? "video" : "mic")
            .font(.system(size: isVideoMode ? 18 : 20, weight: .regular))
            .foregroundStyle(VostokColors.controlPrimary)
            .frame(width: 44, height: 44)
            .background(glassCircleBackground)
            .clipShape(Circle())
            .scaleEffect(isHeld ? 1.15 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: isHeld)
            .animation(.spring(response: 0.15, dampingFraction: 0.75), value: isVideoMode)
            .accessibilityLabel(isVideoMode ? "Record video message" : "Record voice message")
            .accessibilityHint("Hold to record. Tap to switch mode. Slide left to cancel, slide up to lock.")
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .global)
                    .onChanged { value in
                        if !isHeld {
                            // Touch-down: schedule the long-press threshold
                            isHeld = true
                            longPressTriggered = false
                            holdTask?.cancel()
                            holdTask = Task { @MainActor in
                                try? await Task.sleep(nanoseconds: 200_000_000) // 200 ms
                                guard !Task.isCancelled else { return }
                                longPressTriggered = true
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                onStartRecording()
                            }
                        } else if longPressTriggered {
                            // Finger moving while recording — forward drag delta
                            onDragChanged(value.translation)
                        }
                    }
                    .onEnded { _ in
                        isHeld = false
                        holdTask?.cancel()
                        holdTask = nil
                        if longPressTriggered {
                            longPressTriggered = false
                            onEndRecording()
                        } else {
                            // Short tap (< 200 ms): toggle between mic and video mode
                            withAnimation(.spring(response: 0.15, dampingFraction: 0.75)) {
                                isVideoMode.toggle()
                            }
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        }
                    }
            )
    }

    private var glassCircleBackground: some View {
        Circle()
            .fill(.ultraThinMaterial)
            .overlay(Circle().fill(VostokColors.glassLight.opacity(0.7)))
            .overlay(Circle().strokeBorder(VostokColors.separatorVibrant.opacity(0.45), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.08), radius: 16, y: 4)
    }
}
