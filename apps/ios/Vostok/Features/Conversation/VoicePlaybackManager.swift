import AVFoundation
import Foundation

@MainActor
final class VoicePlaybackManager: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published private(set) var isPlaying = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var progress: Double = 0      // 0.0 … 1.0
    @Published private(set) var playbackSpeed: Float = 1.0 // 1.0, 1.5, 2.0

    private var player: AVAudioPlayer?
    private var progressTask: Task<Void, Never>?

    // MARK: – Playback control

    func play(data: Data) {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)

            let player = try AVAudioPlayer(data: data)
            player.delegate = self
            player.enableRate = true
            player.rate = playbackSpeed
            player.prepareToPlay()
            player.play()

            self.player = player
            isPlaying = true
            progress = 0
            errorMessage = nil
            startProgressTracking()
        } catch {
            isPlaying = false
            errorMessage = error.localizedDescription
        }
    }

    func stop() {
        player?.stop()
        isPlaying = false
        progress = 0
        stopProgressTracking()
    }

    func seek(to ratio: Double) {
        guard let player else { return }
        player.currentTime = player.duration * max(0, min(1, ratio))
        progress = max(0, min(1, ratio))
    }

    func cycleSpeed() {
        switch playbackSpeed {
        case 1.0:  playbackSpeed = 1.5
        case 1.5:  playbackSpeed = 2.0
        default:   playbackSpeed = 1.0
        }
        player?.rate = playbackSpeed
    }

    // MARK: – Duration helper

    func durationText(for data: Data) -> String {
        guard let player = try? AVAudioPlayer(data: data) else { return "0:00" }
        let seconds = Int(player.duration.rounded())
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    // MARK: – Progress tracking

    private func startProgressTracking() {
        stopProgressTracking()
        progressTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, let player = self.player, player.duration > 0 else { return }
                self.progress = player.currentTime / player.duration
                try? await Task.sleep(nanoseconds: 100_000_000) // 100 ms
            }
        }
    }

    private func stopProgressTracking() {
        progressTask?.cancel()
        progressTask = nil
    }

    // MARK: – AVAudioPlayerDelegate

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.isPlaying = false
            self.progress = 0
            self.stopProgressTracking()
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in
            self.isPlaying = false
            self.progress = 0
            self.stopProgressTracking()
            self.errorMessage = error?.localizedDescription ?? "Failed to decode audio."
        }
    }
}
