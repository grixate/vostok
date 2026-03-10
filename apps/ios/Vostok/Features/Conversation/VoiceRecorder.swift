import AVFoundation
import Foundation

@MainActor
final class VoiceRecorder: ObservableObject {
    @Published private(set) var isRecording = false
    @Published private(set) var outputURL: URL?
    @Published private(set) var errorMessage: String?

    private var recorder: AVAudioRecorder?

    func start() async {
        let session = AVAudioSession.sharedInstance()
        let granted = await requestRecordPermission(session: session)
        guard granted else {
            errorMessage = "Microphone permission is not granted."
            return
        }

        let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
            recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder?.isMeteringEnabled = true
            recorder?.record()
            isRecording = true
            outputURL = url
            errorMessage = nil
        } catch {
            isRecording = false
            errorMessage = error.localizedDescription
        }
    }

    func stop() {
        recorder?.stop()
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false)
    }

    func pause() {
        recorder?.pause()
    }

    func resumeRecording() {
        recorder?.record()
    }

    func averagePower(forChannel channel: Int = 0) -> Float {
        recorder?.updateMeters()
        return recorder?.averagePower(forChannel: channel) ?? -60
    }

    private func requestRecordPermission(session: AVAudioSession) async -> Bool {
        switch session.recordPermission {
        case .granted:
            return true
        case .denied:
            return false
        case .undetermined:
            return await withCheckedContinuation { continuation in
                session.requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        @unknown default:
            return false
        }
    }
}
