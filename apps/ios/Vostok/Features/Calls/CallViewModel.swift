import Foundation

@MainActor
final class CallViewModel: ObservableObject {
    @Published var activeCall: CallDTO?
    @Published var endpointState: EndpointStateDTO?
    @Published var pendingMediaEvents: [String] = []
    @Published var signals: [CallSignalDTO] = []
    @Published var selectedSignalType = "offer"
    @Published var signalPayload = ""
    @Published var mediaEvent = ""
    @Published var turnCredentialsSummary: String?
    @Published var isPolling = false
    @Published var isMuted = false
    @Published var isSpeakerEnabled = true
    @Published var isVideoEnabled = true
    @Published var lastError: String?

    private let repository: CallRepository
    private var pollTask: Task<Void, Never>?

    init(repository: CallRepository) {
        self.repository = repository
    }

    deinit {
        pollTask?.cancel()
    }

    func refreshActive(token: String, chatID: String) async {
        do {
            let call = try await repository.activeCall(token: token, chatID: chatID)
            updateActiveCall(call, token: token)
            if let callID = activeCall?.id {
                await refreshState(token: token, callID: callID)
            } else {
                endpointState = nil
                pendingMediaEvents = []
                signals = []
            }
            lastError = nil
        } catch let error as VostokAPIError {
            if case .notFound = error {
                updateActiveCall(nil, token: token)
                endpointState = nil
                pendingMediaEvents = []
                signals = []
                lastError = nil
            } else {
                lastError = error.localizedDescription
            }
        } catch {
            lastError = error.localizedDescription
        }
    }

    func start(token: String, chatID: String, mode: String = "voice") async {
        do {
            let call = try await repository.createCall(token: token, chatID: chatID, mode: mode)
            updateActiveCall(call, token: token)
            if let callID = activeCall?.id {
                _ = try? await repository.provisionEndpoint(token: token, callID: callID)
                await refreshState(token: token, callID: callID)
            }
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func join(token: String, trackKind: String) async {
        guard let callID = activeCall?.id else { return }
        do {
            let call = try await repository.joinCall(token: token, callID: callID, trackKind: trackKind)
            updateActiveCall(call, token: token)
            _ = try? await repository.provisionEndpoint(token: token, callID: callID)
            await refreshState(token: token, callID: callID)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func leave(token: String) async {
        guard let callID = activeCall?.id else { return }
        do {
            let call = try await repository.leaveCall(token: token, callID: callID)
            updateActiveCall(call, token: token)
            await refreshState(token: token, callID: callID)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func end(token: String) async {
        guard let callID = activeCall?.id else { return }
        do {
            let call = try await repository.endCall(token: token, callID: callID)
            updateActiveCall(call, token: token)
            stopPolling()
            endpointState = nil
            pendingMediaEvents = []
            signals = []
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func refreshState(token: String, callID: String) async {
        do {
            async let callTask = repository.callState(token: token, callID: callID)
            async let endpointTask = repository.pollEndpoint(token: token, callID: callID)
            async let signalsTask = repository.callSignals(token: token, callID: callID)

            let updatedCall = try await callTask
            let endpoint = try await endpointTask
            let callSignals = try await signalsTask

            updateActiveCall(updatedCall, token: token)
            endpointState = endpoint.endpoint
            pendingMediaEvents = endpoint.mediaEvents ?? []
            signals = sortedSignals(callSignals)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func sendSignal(token: String) async {
        guard let callID = activeCall?.id else { return }
        let payload = signalPayload.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !payload.isEmpty else { return }

        do {
            let signal = try await repository.emitSignal(
                token: token,
                callID: callID,
                signalType: selectedSignalType,
                payload: payload,
                targetDeviceID: nil
            )
            signalPayload = ""
            signals = sortedSignals(signals + [signal])
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func sendMediaEvent(token: String) async {
        guard let callID = activeCall?.id else { return }
        let event = mediaEvent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !event.isEmpty else { return }

        do {
            let response = try await repository.pushEndpointMediaEvent(token: token, callID: callID, event: event)
            mediaEvent = ""
            endpointState = response.endpoint
            pendingMediaEvents = response.mediaEvents ?? []
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func fetchTurnCredentials(token: String) async {
        do {
            let turn = try await repository.turnCredentials(token: token)
            let primaryURI = turn.uris.first ?? "n/a"
            turnCredentialsSummary = "\(turn.username) • \(primaryURI)"
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func togglePolling(token: String) {
        guard let callID = activeCall?.id else { return }
        if isPolling {
            stopPolling()
            return
        }

        startPolling(token: token, callID: callID)
    }

    func stopPolling() {
        isPolling = false
        pollTask?.cancel()
        pollTask = nil
    }

    var statusTitle: String {
        guard let call = activeCall else { return "No Active Call" }
        switch normalizedStatus(call.status) {
        case "created":
            return "Created"
        case "ringing":
            return "Ringing"
        case "active":
            return "In Call"
        case "joining":
            return "Joining"
        case "ended":
            return "Ended"
        case "left":
            return "Left"
        default:
            return call.status.capitalized
        }
    }

    var statusSubtitle: String {
        guard let call = activeCall else { return "Start a voice or video call for this chat." }
        return "Mode: \(call.mode.capitalized) • ID: \(call.id)"
    }

    var canStartCall: Bool {
        guard let call = activeCall else { return true }
        return isTerminalStatus(call.status)
    }

    var canJoinCall: Bool {
        guard let call = activeCall else { return false }
        return !isTerminalStatus(call.status)
    }

    var canLeaveCall: Bool {
        guard let call = activeCall else { return false }
        return normalizedStatus(call.status) == "active" || normalizedStatus(call.status) == "joining"
    }

    var canEndCall: Bool {
        guard let call = activeCall else { return false }
        return !isTerminalStatus(call.status)
    }

    private func updateActiveCall(_ call: CallDTO?, token: String) {
        activeCall = call
        guard let call else {
            stopPolling()
            return
        }

        if shouldAutoPoll(status: call.status) {
            startPolling(token: token, callID: call.id)
        } else {
            stopPolling()
        }
    }

    private func startPolling(token: String, callID: String) {
        isPolling = true
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await refreshState(token: token, callID: callID)
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func shouldAutoPoll(status: String) -> Bool {
        !isTerminalStatus(status)
    }

    private func isTerminalStatus(_ status: String) -> Bool {
        let normalized = normalizedStatus(status)
        return normalized == "ended" || normalized == "left" || normalized == "failed" || normalized == "cancelled"
    }

    private func normalizedStatus(_ status: String) -> String {
        status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private func sortedSignals(_ input: [CallSignalDTO]) -> [CallSignalDTO] {
        input.sorted { lhs, rhs in
            let leftTime = lhs.insertedAt ?? ""
            let rightTime = rhs.insertedAt ?? ""
            if leftTime == rightTime {
                return (lhs.id ?? "") < (rhs.id ?? "")
            }
            return leftTime < rightTime
        }
    }
}
