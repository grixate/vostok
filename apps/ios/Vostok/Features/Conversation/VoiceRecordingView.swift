import SwiftUI

// MARK: - Uniform recording state for the bar

/// Lightweight value bag that both `VoiceRecordingViewModel` and
/// `RoundVideoRecordingViewModel` can produce so the recording bar
/// doesn't need to know which kind of recording is active.
struct RecordingBarState: Equatable {
    enum Phase: Equatable { case idle, recordingUnlocked, recordingLocked, paused }
    var phase: Phase = .idle
    var elapsedText: String = "0:00"
    var dragOffset: CGSize = .zero
    var amplitudeSamples: [Float] = []
}

/// Actions the recording bar can invoke. Both VMs conform.
protocol RecordingBarActions: AnyObject {
    func discardRecording()
    func pauseRecording()
    func resumeRecording()
    func sendLocked()
}

extension VoiceRecordingViewModel: RecordingBarActions {}
extension RoundVideoRecordingViewModel: RecordingBarActions {}

// MARK: - Voice recording view (accepts voice VM)

/// Full-width recording panel that slides up above the composer.
/// In UNLOCKED mode shows a timer + slide-to-cancel hint + lock icon.
/// In LOCKED / PAUSED mode shows a live waveform + discard / pause-resume / send controls.
struct VoiceRecordingView: View {
    @ObservedObject var viewModel: VoiceRecordingViewModel

    var body: some View {
        RecordingBarView(
            state: barState,
            actions: viewModel
        )
    }

    private var barState: RecordingBarState {
        RecordingBarState(
            phase: phase(from: viewModel.state),
            elapsedText: viewModel.elapsedText,
            dragOffset: viewModel.dragOffset,
            amplitudeSamples: viewModel.amplitudeSamples
        )
    }

    private func phase(from state: VoiceRecordingViewModel.RecordingState) -> RecordingBarState.Phase {
        switch state {
        case .idle: return .idle
        case .recordingUnlocked: return .recordingUnlocked
        case .recordingLocked: return .recordingLocked
        case .paused: return .paused
        }
    }
}

// MARK: - Video recording bar view (accepts video VM)

struct VideoRecordingView: View {
    @ObservedObject var viewModel: RoundVideoRecordingViewModel

    var body: some View {
        RecordingBarView(
            state: barState,
            actions: viewModel
        )
    }

    private var barState: RecordingBarState {
        RecordingBarState(
            phase: phase(from: viewModel.state),
            elapsedText: viewModel.elapsedText,
            dragOffset: viewModel.dragOffset,
            amplitudeSamples: viewModel.amplitudeSamples
        )
    }

    private func phase(from state: RoundVideoRecordingViewModel.RecordingState) -> RecordingBarState.Phase {
        switch state {
        case .idle: return .idle
        case .recordingUnlocked: return .recordingUnlocked
        case .recordingLocked: return .recordingLocked
        case .paused: return .paused
        }
    }
}

// MARK: - Shared recording bar UI

struct RecordingBarView: View {
    let state: RecordingBarState
    weak var actions: RecordingBarActions?

    var body: some View {
        Group {
            switch state.phase {
            case .idle:
                EmptyView()
            case .recordingUnlocked:
                unlockedBar
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            case .recordingLocked, .paused:
                lockedBar
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.75), value: state.phase)
    }

    // MARK: – Unlocked mode

    private var unlockedBar: some View {
        HStack(spacing: 0) {
            // Red pulsing dot + timer
            HStack(spacing: 6) {
                Circle()
                    .fill(Color.red)
                    .frame(width: 10, height: 10)
                    .modifier(PulsingOpacityModifier())

                Text(state.elapsedText)
                    .font(.system(size: 15, weight: .medium).monospacedDigit())
                    .foregroundStyle(VostokColors.labelPrimary)
            }
            .fixedSize()
            .padding(.leading, 14)

            // Compact live waveform
            waveformView
                .frame(width: 40)
                .clipped()
                .padding(.leading, 6)
                .opacity(0.55)

            Spacer(minLength: 12)

            // Slide-to-cancel hint
            HStack(spacing: 3) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 12, weight: .medium))
                Text("Slide to cancel")
                    .font(.system(size: 14, weight: .regular))
            }
            .foregroundStyle(VostokColors.labelSecondary)
            .offset(x: min(0, state.dragOffset.width * 0.35))

            Spacer(minLength: 12)

            // Lock icon
            Image(systemName: "lock.fill")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(VostokColors.labelSecondary)
                .padding(.trailing, 14)
        }
        .frame(height: 52)
        .background(recordingBarBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.horizontal, 8)
        .padding(.bottom, 4)
    }

    // MARK: – Locked / Paused mode

    private var lockedBar: some View {
        HStack(spacing: 10) {
            // Discard
            Button {
                withAnimation { actions?.discardRecording() }
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(.red)
                    .frame(width: 40, height: 40)
                    .background(.ultraThinMaterial, in: Circle())
                    .overlay(Circle().strokeBorder(VostokColors.separatorVibrant.opacity(0.4), lineWidth: 0.5))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Discard recording")

            // Waveform + timer
            VStack(alignment: .leading, spacing: 3) {
                waveformView
                HStack(spacing: 0) {
                    Text(state.elapsedText)
                        .font(.system(size: 11, weight: .medium).monospacedDigit())
                        .foregroundStyle(VostokColors.labelSecondary)
                    Spacer(minLength: 0)
                }
            }
            .frame(maxWidth: .infinity)

            // Pause / Resume
            Button {
                if state.phase == .paused {
                    actions?.resumeRecording()
                } else {
                    actions?.pauseRecording()
                }
            } label: {
                Image(systemName: state.phase == .paused ? "play.fill" : "pause.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(VostokColors.labelSecondary, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(state.phase == .paused ? "Resume recording" : "Pause recording")

            // Send
            Button {
                actions?.sendLocked()
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(VostokColors.accent, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Send recording")
        }
        .padding(.horizontal, 12)
        .frame(height: 64)
        .background(recordingBarBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.horizontal, 8)
        .padding(.bottom, 4)
    }

    // MARK: – Waveform

    private var waveformView: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(0..<40, id: \.self) { index in
                let sample: Float = index < state.amplitudeSamples.count
                    ? state.amplitudeSamples[index]
                    : 0
                RoundedRectangle(cornerRadius: 1)
                    .fill(VostokColors.accent.opacity(sample > 0.01 ? 1.0 : 0.25))
                    .frame(width: 2, height: max(4, CGFloat(sample) * 22))
                    .animation(.easeOut(duration: 0.05), value: sample)
            }
        }
        .frame(height: 22)
        .clipped()
    }

    // MARK: – Background

    private var recordingBarBackground: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(VostokColors.glassLight.opacity(0.75))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(VostokColors.separatorVibrant.opacity(0.45), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.08), radius: 12, y: 3)
    }
}

// MARK: – Pulsing red dot

private struct PulsingOpacityModifier: ViewModifier {
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        content
            .opacity(isPulsing ? 0.25 : 1.0)
            .animation(
                .easeInOut(duration: 1.0).repeatForever(autoreverses: true),
                value: isPulsing
            )
            .onAppear { isPulsing = true }
    }
}
