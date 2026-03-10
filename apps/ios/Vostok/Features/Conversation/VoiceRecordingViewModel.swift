import Foundation
import UIKit

@MainActor
final class VoiceRecordingViewModel: ObservableObject {

    enum RecordingState: Equatable {
        case idle
        case recordingUnlocked
        case recordingLocked
        case paused
    }

    @Published private(set) var state: RecordingState = .idle
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var amplitudeSamples: [Float] = []
    @Published private(set) var dragOffset: CGSize = .zero
    @Published private(set) var errorMessage: String?

    /// Called with the recorded file URL when the user sends a voice message.
    /// The handler is responsible for reading and uploading the file.
    var sendHandler: ((URL) -> Void)?

    let recorder = VoiceRecorder()

    var isVisible: Bool { state != .idle }

    var elapsedText: String {
        let totalSeconds = Int(elapsed)
        return String(format: "%d:%02d", totalSeconds / 60, totalSeconds % 60)
    }

    private var startDate: Date?
    private var accumulatedElapsed: TimeInterval = 0
    private var elapsedTask: Task<Void, Never>?
    private var meterTask: Task<Void, Never>?

    // MARK: - State Transitions

    func startRecording() async {
        guard state == .idle else { return }
        errorMessage = nil
        await recorder.start()
        if let recorderError = recorder.errorMessage {
            errorMessage = recorderError
            return
        }
        guard recorder.isRecording else { return }
        state = .recordingUnlocked
        startDate = Date()
        elapsed = 0
        dragOffset = .zero
        amplitudeSamples = []
        startTimers()
    }

    /// Called when the user releases the mic button in UNLOCKED mode → send immediately.
    func handleRelease() {
        guard state == .recordingUnlocked else { return }
        stopAndSend()
    }

    /// Called on drag gesture change from `VoiceRecordButton` in UNLOCKED mode.
    /// Automatically transitions to cancel (drag left >110pt) or lock (drag up >80pt).
    func handleDrag(translation: CGSize) {
        guard state == .recordingUnlocked else { return }
        dragOffset = translation
        if translation.width < -110 {
            cancelRecording()
        } else if translation.height < -80 {
            lockRecording()
        }
    }

    func lockRecording() {
        guard state == .recordingUnlocked else { return }
        state = .recordingLocked
        dragOffset = .zero
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    func cancelRecording() {
        recorder.stop()
        stopTimers()
        cleanupOutputFile()
        resetState()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    func sendLocked() {
        guard state == .recordingLocked || state == .paused else { return }
        stopAndSend()
    }

    func pauseRecording() {
        guard state == .recordingLocked else { return }
        recorder.pause()
        state = .paused
        accumulatedElapsed = elapsed
        stopTimers()
    }

    func resumeRecording() {
        guard state == .paused else { return }
        recorder.resumeRecording()
        state = .recordingLocked
        // Adjust startDate so elapsed = Date() - startDate gives correct total
        startDate = Date().addingTimeInterval(-accumulatedElapsed)
        startTimers()
    }

    func discardRecording() {
        recorder.stop()
        stopTimers()
        cleanupOutputFile()
        resetState()
    }

    // MARK: - Private Helpers

    private func stopAndSend() {
        let url = recorder.outputURL
        recorder.stop()
        stopTimers()
        resetState()
        if let url {
            sendHandler?(url)
        }
    }

    private func cleanupOutputFile() {
        if let url = recorder.outputURL {
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func resetState() {
        state = .idle
        elapsed = 0
        dragOffset = .zero
        amplitudeSamples = []
        startDate = nil
        accumulatedElapsed = 0
    }

    // MARK: - Timers (async Task loops)

    private func startTimers() {
        startElapsedTask()
        startMeterTask()
    }

    private func stopTimers() {
        stopElapsedTask()
        stopMeterTask()
    }

    private func startElapsedTask() {
        elapsedTask?.cancel()
        elapsedTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if let startDate = self.startDate {
                    self.elapsed = Date().timeIntervalSince(startDate)
                }
                try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 s
            }
        }
    }

    private func stopElapsedTask() {
        elapsedTask?.cancel()
        elapsedTask = nil
    }

    private func startMeterTask() {
        meterTask?.cancel()
        meterTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let power = self.recorder.averagePower()
                // Normalize dB range −60…0 → 0…1
                let normalized = max(0, min(1, (power + 60) / 60))
                if self.amplitudeSamples.count >= 40 {
                    self.amplitudeSamples.removeFirst()
                }
                self.amplitudeSamples.append(normalized)
                try? await Task.sleep(nanoseconds: 50_000_000) // 50 ms
            }
        }
    }

    private func stopMeterTask() {
        meterTask?.cancel()
        meterTask = nil
    }
}
