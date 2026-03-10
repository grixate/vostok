import AVFoundation
import Foundation

@MainActor
final class RoundVideoPlaybackManager: ObservableObject {
    @Published var activeUploadID: String?
    @Published var isPlaying: Bool = false
    @Published var isMuted: Bool = true
    @Published var progress: Double = 0
    @Published var duration: String = "0:00"
    @Published var errorMessage: String?

    private(set) var player: AVPlayer?
    private var timeObserver: Any?
    private var itemEndObserver: NSObjectProtocol?

    func isActive(uploadID: String) -> Bool {
        activeUploadID == uploadID
    }

    /// Load video data and begin playback.
    func play(data: Data, uploadID: String) {
        // Write to temp file so AVPlayer can seek
        let url = writeTempFile(data: data, ext: "mov")
        guard let url else {
            errorMessage = "Could not write video to disk."
            return
        }
        stopAndClear()

        let item = AVPlayerItem(url: url)
        let newPlayer = AVPlayer(playerItem: item)
        newPlayer.isMuted = true
        self.player = newPlayer
        self.activeUploadID = uploadID
        self.isMuted = true
        self.progress = 0
        self.duration = "0:00"

        // Observe duration
        item.asset.loadValuesAsynchronously(forKeys: ["duration"]) { [weak self, weak item] in
            DispatchQueue.main.async {
                guard let self, let item else { return }
                let seconds = item.duration.seconds
                if seconds.isFinite && seconds > 0 {
                    self.duration = Self.formatDuration(seconds)
                }
            }
        }

        timeObserver = newPlayer.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
            queue: .main
        ) { [weak self, weak item] time in
            guard let self, let item else { return }
            let total = item.duration.seconds
            let current = time.seconds
            if total > 0 && total.isFinite {
                self.progress = current / total
                // Update displayed time during playback
                self.duration = Self.formatDuration(total - current)
            }
        }

        itemEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.isPlaying = false
            self.progress = 0
            self.player?.seek(to: .zero)
            if let item = self.player?.currentItem {
                self.duration = Self.formatDuration(item.duration.seconds)
            }
        }

        newPlayer.play()
        isPlaying = true
    }

    func toggleMute() {
        isMuted.toggle()
        player?.isMuted = isMuted
    }

    func pause() {
        player?.pause()
        isPlaying = false
    }

    func resume() {
        player?.play()
        isPlaying = true
    }

    func stop() {
        stopAndClear()
    }

    private func stopAndClear() {
        player?.pause()
        if let obs = timeObserver {
            player?.removeTimeObserver(obs)
            timeObserver = nil
        }
        if let obs = itemEndObserver {
            NotificationCenter.default.removeObserver(obs)
            itemEndObserver = nil
        }
        player = nil
        activeUploadID = nil
        isPlaying = false
        progress = 0
        isMuted = true
    }

    private func writeTempFile(data: Data, ext: String) -> URL? {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(ext)
        do {
            try data.write(to: tmp)
            return tmp
        } catch {
            return nil
        }
    }

    private static func formatDuration(_ seconds: Double) -> String {
        guard seconds.isFinite && seconds >= 0 else { return "0:00" }
        let total = Int(seconds)
        let m = total / 60
        let s = total % 60
        return String(format: "%d:%02d", m, s)
    }
}
