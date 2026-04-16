import Foundation
import CallKit
import AVFoundation

/// Manages CallKit integration for native call UI on iOS.
/// Registers incoming calls with the system so they appear on the lock screen,
/// and reports outgoing calls for proper audio session management.
final class CallKitManager: NSObject, ObservableObject {
    static let shared = CallKitManager()

    private let provider: CXProvider
    private let callController = CXCallController()

    /// Currently active call UUID (nil when no call is in progress).
    @Published private(set) var activeCallUUID: UUID?
    @Published private(set) var isCallActive = false

    /// Callbacks for call lifecycle events.
    var onAnswerCall: ((UUID) -> Void)?
    var onEndCall: ((UUID) -> Void)?
    var onStartCall: ((UUID, String) -> Void)?

    private override init() {
        let config = CXProviderConfiguration()
        config.localizedName = "Vostok"
        config.supportsVideo = true
        config.maximumCallsPerGroup = 1
        config.maximumCallGroups = 1
        config.supportedHandleTypes = [.generic]
        config.iconTemplateImageData = nil // Can set app icon data later

        self.provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    // MARK: – Report incoming call

    /// Reports an incoming call to the system. This makes the call appear on the lock screen
    /// and in the native call UI. Call this from PushKit VoIP push handler.
    func reportIncomingCall(
        uuid: UUID,
        callerName: String,
        hasVideo: Bool = false,
        completion: @escaping (Error?) -> Void
    ) {
        let update = CXCallUpdate()
        update.localizedCallerName = callerName
        update.hasVideo = hasVideo
        update.remoteHandle = CXHandle(type: .generic, value: callerName)
        update.supportsDTMF = false
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false

        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if error == nil {
                self?.activeCallUUID = uuid
                self?.isCallActive = true
            }
            completion(error)
        }
    }

    // MARK: – Report outgoing call

    /// Reports that the user is starting an outgoing call.
    func startOutgoingCall(uuid: UUID, handle: String) {
        let handle = CXHandle(type: .generic, value: handle)
        let startAction = CXStartCallAction(call: uuid, handle: handle)
        startAction.isVideo = false

        let transaction = CXTransaction(action: startAction)
        callController.request(transaction) { [weak self] error in
            if error == nil {
                self?.activeCallUUID = uuid
                self?.isCallActive = true
                // Report that the call is connecting
                self?.provider.reportOutgoingCall(with: uuid, startedConnectingAt: Date())
            }
        }
    }

    /// Reports that the outgoing call has connected (audio is flowing).
    func reportOutgoingCallConnected(uuid: UUID) {
        provider.reportOutgoingCall(with: uuid, connectedAt: Date())
    }

    // MARK: – End call

    /// Ends the current call from the app side.
    func endCall(uuid: UUID? = nil) {
        guard let callUUID = uuid ?? activeCallUUID else { return }
        let endAction = CXEndCallAction(call: callUUID)
        let transaction = CXTransaction(action: endAction)
        callController.request(transaction) { _ in }
    }

    /// Reports that the remote side ended the call.
    func reportCallEnded(uuid: UUID? = nil, reason: CXCallEndedReason = .remoteEnded) {
        guard let callUUID = uuid ?? activeCallUUID else { return }
        provider.reportCall(with: callUUID, endedAt: Date(), reason: reason)
        activeCallUUID = nil
        isCallActive = false
    }
}

// MARK: – CXProviderDelegate

extension CallKitManager: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        activeCallUUID = nil
        isCallActive = false
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        // Configure audio session for call
        configureAudioSession()
        onAnswerCall?(action.callUUID)
        activeCallUUID = action.callUUID
        isCallActive = true
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        onEndCall?(action.callUUID)
        activeCallUUID = nil
        isCallActive = false
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        configureAudioSession()
        onStartCall?(action.callUUID, action.handle.value)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        // Handle mute toggle from system UI
        action.fulfill()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        // Audio session is now active for the call
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        // Audio session deactivated after call ends
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
        } catch {
            // Best-effort audio configuration
        }
    }
}
