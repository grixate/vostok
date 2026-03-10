import AVFoundation
import SwiftUI

// MARK: - Camera preview layer (UIKit → SwiftUI bridge)

struct CameraPreviewRepresentable: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> CameraPreviewUIView {
        let view = CameraPreviewUIView()
        view.previewLayer.videoGravity = .resizeAspectFill
        // Connect the session on a background thread.
        // Setting previewLayer.session on a running session causes AVFoundation to call
        // commitConfiguration internally, which blocks by spinning the CFRunLoop via
        // AVRunLoopCondition._waitInMode. If this happens during SwiftUI's rendering pass
        // it causes a run-loop reentrancy crash (EXC_BREAKPOINT). Moving it off-main
        // avoids that. AVCaptureVideoPreviewLayer.session is thread-safe.
        let s = session
        DispatchQueue.global(qos: .userInteractive).async {
            view.previewLayer.session = s
        }
        return view
    }

    func updateUIView(_ uiView: CameraPreviewUIView, context: Context) {}

    static func dismantleUIView(_ uiView: CameraPreviewUIView, coordinator: ()) {
        let layer = uiView.previewLayer
        DispatchQueue.global(qos: .userInteractive).async {
            layer.session = nil
        }
    }
}

final class CameraPreviewUIView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

// MARK: - Round video recording view model

/// Manages AVCaptureSession + movie recording with the same state machine as
/// `VoiceRecordingViewModel` so it plugs into the identical composer recording bar.
@MainActor
final class RoundVideoRecordingViewModel: NSObject, ObservableObject {

    enum RecordingState: Equatable {
        case idle
        case recordingUnlocked
        case recordingLocked
        case paused
    }

    // Published state consumed by VoiceRecordingView and the camera overlay
    @Published private(set) var state: RecordingState = .idle
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var amplitudeSamples: [Float] = []
    @Published private(set) var dragOffset: CGSize = .zero
    @Published private(set) var errorMessage: String?

    /// Called with the recorded file URL when the user sends a video message.
    var sendHandler: ((URL) -> Void)?

    let captureSession = AVCaptureSession()

    var isVisible: Bool { state != .idle }

    /// Set when the user releases the record button before recording has fully started.
    /// `startRecording()` checks this flag and auto-locks as soon as state becomes `.recordingUnlocked`.
    private var pendingLock = false

    var elapsedText: String {
        let total = Int(elapsed)
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    // MARK: Private

    private let movieOutput = AVCaptureMovieFileOutput()
    private var audioInput: AVCaptureDeviceInput?
    private var startDate: Date?
    private var accumulatedElapsed: TimeInterval = 0
    private var elapsedTask: Task<Void, Never>?
    private var meterTask: Task<Void, Never>?
    private var sessionConfigured = false
    private var pendingSendURL: URL?
    private var isMicMuted = false
    /// Whether AVCaptureMovieFileOutput is actually recording to a file.
    /// On the Simulator this may be false, but the UI still works.
    private var isFileRecording = false

    // MARK: - Setup

    /// Configure the capture session and start it running, entirely off the main thread.
    /// Returns the audio input that was added so the caller can store it on @MainActor.
    private func configureAndStartSession() async -> AVCaptureDeviceInput? {
        guard !sessionConfigured else { return audioInput }
        sessionConfigured = true

        let session = captureSession
        let output = movieOutput

        return await Task.detached { () -> AVCaptureDeviceInput? in
            session.beginConfiguration()
            session.sessionPreset = .medium

            // Build device type list. On iOS 17+ include .external so that
            // Continuity Camera (Mac webcam) is discovered on the Simulator.
            var deviceTypes: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera]
            if #available(iOS 17, *) {
                deviceTypes.append(.external)
            }
            // Search with .unspecified so external cameras (position == .unspecified) show up.
            let discovery = AVCaptureDevice.DiscoverySession(
                deviceTypes: deviceTypes,
                mediaType: .video,
                position: .unspecified
            )
            // Prefer front-facing, then back, then any (incl. Continuity Camera).
            let videoDevice = discovery.devices.first(where: { $0.position == .front })
                ?? discovery.devices.first(where: { $0.position == .back })
                ?? discovery.devices.first
                ?? AVCaptureDevice.default(for: .video)

            if let videoDevice,
               let videoInput = try? AVCaptureDeviceInput(device: videoDevice),
               session.canAddInput(videoInput) {
                session.addInput(videoInput)
            }

            // Audio input
            var capturedAudioInput: AVCaptureDeviceInput?
            if let audioDevice = AVCaptureDevice.default(for: .audio),
               let input = try? AVCaptureDeviceInput(device: audioDevice),
               session.canAddInput(input) {
                session.addInput(input)
                capturedAudioInput = input
            }

            // Movie output
            if session.canAddOutput(output) {
                session.addOutput(output)
            }
            output.maxRecordedDuration = CMTime(seconds: 60, preferredTimescale: 600)

            session.commitConfiguration()
            session.startRunning()
            return capturedAudioInput
        }.value
    }

    // MARK: - State Transitions

    func startRecording() async {
        guard state == .idle else { return }
        errorMessage = nil

        // Request camera permission first.
        let camStatus = AVCaptureDevice.authorizationStatus(for: .video)
        if camStatus == .notDetermined {
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            guard granted else { errorMessage = "Camera access denied."; return }
        } else if camStatus == .denied || camStatus == .restricted {
            errorMessage = "Camera access denied. Please enable in Settings."
            return
        }
        // Request microphone (best-effort; recording continues silently if denied).
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .audio)
        }

        // Run heavy session setup + startRunning off the main thread.
        let capturedAudioInput = await configureAndStartSession()
        audioInput = capturedAudioInput

        guard captureSession.isRunning else {
            errorMessage = "Camera not available."
            sessionConfigured = false  // allow retry
            return
        }

        // Give the capture pipeline time to fully initialise its graph.
        try? await Task.sleep(nanoseconds: 300_000_000) // 300 ms

        // Verify the session has at least one video input before trying to record.
        guard captureSession.inputs.contains(where: {
            ($0 as? AVCaptureDeviceInput)?.device.hasMediaType(.video) == true
        }) else {
            errorMessage = "Camera not available. On iPhone Simulator, enable Continuity Camera in macOS System Settings → General → AirPlay & Handoff."
            stopSession()
            sessionConfigured = false
            return
        }

        // Try to start file recording.
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("round-\(Int(Date().timeIntervalSince1970)).mov")

        var objcError: NSError?
        let fileRecordingStarted = VSTKTryObjC({ [self] in
            movieOutput.startRecording(to: url, recordingDelegate: self)
        }, &objcError)

        guard fileRecordingStarted else {
            let reason = objcError?.localizedDescription ?? "Video recording failed to start."
            errorMessage = reason
            stopSession()
            sessionConfigured = false
            return
        }

        isFileRecording = true
        state = .recordingUnlocked
        startDate = Date()
        elapsed = 0
        dragOffset = .zero
        amplitudeSamples = []
        isMicMuted = false
        startTimers()

        // If the user already released the button while we were starting up, lock immediately.
        if pendingLock {
            pendingLock = false
            lockRecording()
        }
    }

    /// Called when the user releases the record button.
    /// For video, releasing the button always locks the recording (Telegram-style)
    /// so the user can then send or discard from the locked-mode controls.
    /// If recording hasn't started yet, sets `pendingLock` so locking happens as soon
    /// as `startRecording()` transitions to `.recordingUnlocked`.
    func handleRelease() {
        switch state {
        case .recordingUnlocked:
            lockRecording()
        case .idle:
            pendingLock = true
        default:
            break
        }
    }

    /// Called on drag gesture change.
    func handleDrag(translation: CGSize) {
        guard state == .recordingUnlocked else { return }
        dragOffset = translation
        if translation.width < -110 {
            cancelRecording()
        } else if translation.height < -150 {
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
        pendingLock = false
        if isFileRecording { movieOutput.stopRecording() }
        stopTimers()
        stopSession()
        pendingSendURL = nil
        isFileRecording = false
        resetState()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    func sendLocked() {
        guard state == .recordingLocked || state == .paused else { return }
        stopAndSend()
    }

    func pauseRecording() {
        // AVCaptureMovieFileOutput doesn't support pause on iOS < 18.
        // Ignore; the UI will still show the pause button but it won't change state.
    }

    func resumeRecording() {
        // No-op — see pauseRecording() comment.
    }

    func discardRecording() {
        pendingLock = false
        if isFileRecording { movieOutput.stopRecording() }
        stopTimers()
        stopSession()
        pendingSendURL = nil
        isFileRecording = false
        resetState()
    }

    func toggleMic() {
        guard let audioInput else { return }
        isMicMuted.toggle()
        captureSession.beginConfiguration()
        if isMicMuted {
            captureSession.removeInput(audioInput)
        } else if captureSession.canAddInput(audioInput) {
            captureSession.addInput(audioInput)
        }
        captureSession.commitConfiguration()
    }

    var micMuted: Bool { isMicMuted }

    func flipCamera() {
        // Find the current video input and toggle position
        guard let currentInput = captureSession.inputs.compactMap({ $0 as? AVCaptureDeviceInput })
                .first(where: { $0.device.hasMediaType(.video) }) else { return }

        let newPosition: AVCaptureDevice.Position = currentInput.device.position == .front ? .back : .front
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera],
            mediaType: .video,
            position: newPosition
        )
        guard let newDevice = discovery.devices.first,
              let newInput = try? AVCaptureDeviceInput(device: newDevice) else { return }

        captureSession.beginConfiguration()
        captureSession.removeInput(currentInput)
        if captureSession.canAddInput(newInput) {
            captureSession.addInput(newInput)
        }
        captureSession.commitConfiguration()
    }

    // MARK: - Private Helpers

    private func stopAndSend() {
        stopTimers()
        if isFileRecording {
            // Mark that we want to send the file once the delegate fires
            pendingSendURL = movieOutput.outputFileURL
            movieOutput.stopRecording()
            // Session stop + sendHandler happen in the delegate callback
        } else {
            // File recording wasn't available (Simulator) — just clean up
            stopSession()
            isFileRecording = false
            resetState()
        }
    }

    private func stopSession() {
        // Reset sessionConfigured so the next recording attempt re-builds the session.
        // Without this, cancel/discard leaves the session stopped but configured=true,
        // causing configureAndStartSession() to skip setup on the next attempt.
        sessionConfigured = false
        audioInput = nil   // clear stale reference; will be re-acquired on next setup
        let session = captureSession
        Task.detached {
            session.stopRunning()
            // Remove all inputs and outputs so the session is clean for the next use.
            session.beginConfiguration()
            for input in session.inputs { session.removeInput(input) }
            for output in session.outputs { session.removeOutput(output) }
            session.commitConfiguration()
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

    // MARK: - Timers

    private func startTimers() {
        startElapsedTask()
        startMeterTask()
    }

    private func stopTimers() {
        elapsedTask?.cancel(); elapsedTask = nil
        meterTask?.cancel(); meterTask = nil
    }

    private func startElapsedTask() {
        elapsedTask?.cancel()
        elapsedTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, let start = self.startDate else { return }
                self.elapsed = Date().timeIntervalSince(start)
                try? await Task.sleep(nanoseconds: 100_000_000) // 100 ms for smoother display
            }
        }
    }

    /// Generate fake amplitude samples from elapsed time for a "breathing" waveform
    /// (we don't have audio metering from AVCaptureSession the same way AVAudioRecorder provides).
    private func startMeterTask() {
        meterTask?.cancel()
        meterTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let sample = self.synthesizedAmplitude()
                if self.amplitudeSamples.count >= 40 {
                    self.amplitudeSamples.removeFirst()
                }
                self.amplitudeSamples.append(sample)
                try? await Task.sleep(nanoseconds: 50_000_000) // 50 ms
            }
        }
    }

    /// Generates a synthetic waveform sample for visual feedback.
    private func synthesizedAmplitude() -> Float {
        let t: Double = Date().timeIntervalSince1970
        let a: Double = 0.4 * abs(sin(t * 3.0))
        let b: Double = 0.3 * abs(sin(t * 7.0))
        let base = Float(0.3 + a + b)
        let jitter = Float.random(in: 0.6...1.0)
        return base * jitter
    }
}

// MARK: - AVCaptureFileOutputRecordingDelegate

extension RoundVideoRecordingViewModel: AVCaptureFileOutputRecordingDelegate {
    nonisolated func fileOutput(
        _ output: AVCaptureFileOutput,
        didFinishRecordingTo outputFileURL: URL,
        from connections: [AVCaptureConnection],
        error: Error?
    ) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.stopSession()
            if self.pendingSendURL != nil, error == nil {
                self.sendHandler?(outputFileURL)
            } else {
                // Cancelled or error — clean up the file
                try? FileManager.default.removeItem(at: outputFileURL)
            }
            self.pendingSendURL = nil
            self.resetState()
        }
    }
}

// MARK: - Camera preview overlay

/// Fullscreen blurred overlay with the circular camera preview shown during video recording.
struct RoundVideoPreviewOverlay: View {
    @ObservedObject var viewModel: RoundVideoRecordingViewModel
    @State private var appeared = false

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()
                cameraCircle
                Spacer()
                // Recording bar with send/discard/lock controls — rendered inside the overlay
                // so it's not blocked by the full-screen blur layer.
                VideoRecordingView(viewModel: viewModel)
                    .padding(.bottom, 4)
                cameraControls
            }
        }
        .onAppear {
            withAnimation(.spring(response: 0.4, dampingFraction: 0.78)) {
                appeared = true
            }
        }
    }

    // MARK: - Subviews

    private var cameraCircle: some View {
        let size: CGFloat = 260
        let isRecording = viewModel.state == .recordingUnlocked || viewModel.state == .recordingLocked
        return ZStack {
            CameraPreviewRepresentable(session: viewModel.captureSession)
                .frame(width: size, height: size)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(Color.white.opacity(0.15), lineWidth: 1))

            if isRecording {
                RecordingRingView(size: size + 8)
            }
        }
        .scaleEffect(appeared ? 1 : 0.7)
        .opacity(appeared ? 1 : 0)
    }

    private var cameraControls: some View {
        HStack(spacing: 16) {
            #if !targetEnvironment(simulator)
            flipCameraButton
            #endif
            micToggleButton
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var flipCameraButton: some View {
        Button { viewModel.flipCamera() } label: {
            Image(systemName: "camera.rotate")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(VostokColors.controlPrimary)
                .frame(width: 40, height: 40)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(VostokColors.separatorVibrant.opacity(0.3), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
    }

    private var micToggleButton: some View {
        let muted = viewModel.micMuted
        return Button { viewModel.toggleMic() } label: {
            Image(systemName: muted ? "mic.slash" : "mic")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(muted ? .red : VostokColors.controlPrimary)
                .frame(width: 40, height: 40)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(VostokColors.separatorVibrant.opacity(0.3), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
    }
}

/// Pulsing red ring shown around the camera circle during active recording.
private struct RecordingRingView: View {
    let size: CGFloat
    @State private var pulse = false

    var body: some View {
        Circle()
            .strokeBorder(.red, lineWidth: 3)
            .frame(width: size, height: size)
            .opacity(pulse ? 0.5 : 1.0)
            .animation(
                .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                value: pulse
            )
            .onAppear { pulse = true }
    }
}
