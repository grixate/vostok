import Foundation

actor PhoenixRealtimeClient: PhoenixRealtimeClientProtocol {
    private let socketURL: URL
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var ref: Int = 0
    private var topics = Set<String>()
    private var heartbeatTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var authToken: String?
    private var connectionState: RealtimeConnectionState = .disconnected
    private var reconnectAttempt: Int = 0
    private var lastDisconnectReason: String?
    private var lastInboundAt: Date?
    private var diagnosticLog: [String] = []
    private var isPaused = false
    private var networkAvailable = true
    private let maxDiagnosticLogLines = 24

    private let stream: AsyncStream<RealtimeEvent>
    private let continuation: AsyncStream<RealtimeEvent>.Continuation

    nonisolated var events: AsyncStream<RealtimeEvent> { stream }

    init(socketURL: URL) {
        self.socketURL = socketURL
        var storedContinuation: AsyncStream<RealtimeEvent>.Continuation?
        self.stream = AsyncStream<RealtimeEvent> { continuation in
            storedContinuation = continuation
        }
        self.continuation = storedContinuation!
    }

    func connect(token: String) async {
        authToken = token
        isPaused = false
        recordDiagnostic("connect() called")
        guard networkAvailable else {
            transition(to: .disconnected)
            recordDiagnostic("connect aborted: network unavailable")
            return
        }
        guard task == nil else { return }
        transition(to: .connecting)
        _ = await establishConnection(token: token, emitConnected: true)
        await rejoinStoredTopics()
    }

    func disconnect() async {
        authToken = nil
        isPaused = false
        reconnectAttempt = 0
        reconnectTask?.cancel()
        reconnectTask = nil
        recordDiagnostic("disconnect() called")
        teardownSocket(emitDisconnected: true)
        topics.removeAll()
    }

    func pause() async {
        guard !isPaused else { return }
        isPaused = true
        reconnectTask?.cancel()
        reconnectTask = nil
        recordDiagnostic("pause() called")
        teardownSocket(emitDisconnected: false)
        transition(to: .paused)
    }

    func resume() async {
        guard isPaused else { return }
        isPaused = false
        recordDiagnostic("resume() called")
        guard let authToken, task == nil, networkAvailable else { return }
        transition(to: .reconnecting)
        _ = await establishConnection(token: authToken, emitConnected: true)
        await rejoinStoredTopics()
    }

    func updateNetworkAvailability(_ isAvailable: Bool) async {
        guard networkAvailable != isAvailable else { return }
        networkAvailable = isAvailable
        recordDiagnostic("network availability changed: \(isAvailable)")

        if isAvailable {
            guard !isPaused, let _ = authToken, task == nil else { return }
            await scheduleReconnectIfNeeded(immediate: true)
            return
        }

        reconnectTask?.cancel()
        reconnectTask = nil
        if task != nil {
            lastDisconnectReason = "network_unavailable"
            teardownSocket(emitDisconnected: true)
        } else {
            transition(to: .disconnected)
        }
    }

    func forceReconnect(reason: String) async {
        guard authToken != nil else { return }
        recordDiagnostic("forceReconnect() reason=\(reason)")
        teardownSocket(emitDisconnected: true)
        await scheduleReconnectIfNeeded(immediate: true)
    }

    func clearDiagnosticLog() async {
        diagnosticLog.removeAll()
        recordDiagnostic("diagnostic log cleared")
    }

    func snapshotDiagnostics() async -> RealtimeDiagnosticsSnapshot {
        .init(
            connectionState: connectionState,
            reconnectAttempt: reconnectAttempt,
            networkAvailable: networkAvailable,
            lastDisconnectReason: lastDisconnectReason,
            lastInboundAt: lastInboundAt,
            joinedTopics: orderedTopicsForRejoin(topics),
            recentLogLines: diagnosticLog
        )
    }

    func join(topic: String) async {
        topics.insert(topic)
        guard task != nil else { return }

        await sendPhoenix(
            topic: topic,
            event: "phx_join",
            payload: [:]
        )
        continuation.yield(.joined(topic: topic))
    }

    func leave(topic: String) async {
        topics.remove(topic)
        await sendPhoenix(topic: topic, event: "phx_leave", payload: [:])
    }

    func push(topic: String, event: String, payload: [String: Any]) async {
        await sendPhoenix(topic: topic, event: event, payload: payload)
    }

    private func heartbeatLoop() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(25))
            if shouldMarkSocketStale(lastInboundAt: lastInboundAt, now: .now) {
                recordDiagnostic("socket marked stale after 90s idle")
                task?.cancel(with: .goingAway, reason: nil)
                return
            }
            await sendPhoenix(topic: "phoenix", event: "heartbeat", payload: [:])
        }
    }

    private func receiveLoop() async {
        while !Task.isCancelled {
            guard let task else { return }
            do {
                let message = try await task.receive()
                if case let .string(text) = message {
                    lastInboundAt = Date()
                    await parseInbound(text: text)
                }
            } catch {
                await handleConnectionFailure()
                return
            }
        }
    }

    private func establishConnection(token: String, emitConnected: Bool) async -> Bool {
        guard networkAvailable else { return false }
        var components = URLComponents(url: socketURL, resolvingAgainstBaseURL: false)
        var items = components?.queryItems ?? []
        items.append(URLQueryItem(name: "token", value: token))
        components?.queryItems = items

        guard let url = components?.url else { return false }

        let session = URLSession(configuration: .default)
        let ws = session.webSocketTask(with: url)
        ws.resume()
        self.session = session
        task = ws
        lastInboundAt = Date()
        lastDisconnectReason = nil
        recordDiagnostic("opening socket")

        if emitConnected {
            reconnectAttempt = 0
            transition(to: .connected)
            continuation.yield(.connected)
        }

        receiveTask?.cancel()
        heartbeatTask?.cancel()
        receiveTask = Task { await receiveLoop() }
        heartbeatTask = Task { await heartbeatLoop() }
        return true
    }

    private func teardownSocket(emitDisconnected: Bool) {
        heartbeatTask?.cancel()
        receiveTask?.cancel()
        heartbeatTask = nil
        receiveTask = nil

        task?.cancel(with: .normalClosure, reason: nil)
        task = nil

        session?.invalidateAndCancel()
        session = nil

        if emitDisconnected {
            if !isPaused {
                transition(to: .disconnected)
            }
            continuation.yield(.disconnected)
        }
    }

    private func handleConnectionFailure() async {
        lastDisconnectReason = "socket_failure"
        recordDiagnostic("socket failure")
        teardownSocket(emitDisconnected: true)
        await scheduleReconnectIfNeeded()
    }

    private func scheduleReconnectIfNeeded(immediate: Bool = false) async {
        guard reconnectTask == nil,
              let token = authToken,
              shouldScheduleReconnectAfterDrop(isPaused: isPaused, networkAvailable: networkAvailable, hasAuthToken: true)
        else {
            return
        }
        transition(to: stateAfterSocketDrop(isPaused: isPaused, networkAvailable: networkAvailable, hasAuthToken: true))
        reconnectTask = Task { [token] in
            await self.reconnectLoop(token: token, immediate: immediate)
        }
    }

    private func reconnectLoop(token: String, immediate: Bool) async {
        defer { reconnectTask = nil }

        for attempt in 0..<5 {
            if Task.isCancelled || authToken == nil {
                return
            }

            if !networkAvailable {
                transition(to: .disconnected)
                return
            }

            reconnectAttempt = attempt + 1
            let delay = immediate && attempt == 0 ? 0 : reconnectDelaySeconds(attempt: attempt + 1)
            recordDiagnostic("reconnect attempt \(reconnectAttempt) in \(delay)s")
            if delay > 0 {
                try? await Task.sleep(for: .seconds(delay))
            }

            guard task == nil else { return }
            let connected = await establishConnection(token: token, emitConnected: true)
            if connected {
                recordDiagnostic("reconnect attempt \(reconnectAttempt) succeeded")
                await rejoinStoredTopics()
                return
            }
        }
    }

    private func rejoinStoredTopics() async {
        guard task != nil else { return }
        for topic in orderedTopicsForRejoin(topics) {
            await sendPhoenix(topic: topic, event: "phx_join", payload: [:])
            continuation.yield(.joined(topic: topic))
        }
    }

    nonisolated internal func reconnectDelaySeconds(attempt: Int) -> Int {
        let normalizedAttempt = max(1, attempt)
        return min(2 << (normalizedAttempt - 1), 30)
    }

    nonisolated internal func shouldScheduleReconnectAfterDrop(isPaused: Bool, networkAvailable: Bool, hasAuthToken: Bool) -> Bool {
        !isPaused && networkAvailable && hasAuthToken
    }

    nonisolated internal func stateAfterSocketDrop(isPaused: Bool, networkAvailable: Bool, hasAuthToken: Bool) -> RealtimeConnectionState {
        if isPaused {
            return .paused
        }
        if !networkAvailable {
            return .disconnected
        }
        if hasAuthToken {
            return .reconnecting
        }
        return .disconnected
    }

    nonisolated internal func shouldMarkSocketStale(lastInboundAt: Date?, now: Date) -> Bool {
        guard let lastInboundAt else { return false }
        return now.timeIntervalSince(lastInboundAt) > 90
    }

    nonisolated internal func orderedTopicsForRejoin(_ topics: Set<String>) -> [String] {
        topics.sorted()
    }

    private func nextRef() -> String {
        ref += 1
        return String(ref)
    }

    private func sendPhoenix(topic: String, event: String, payload: [String: Any]) async {
        guard let task else { return }

        let message: [Any] = [NSNull(), nextRef(), topic, event, payload]
        guard let data = try? JSONSerialization.data(withJSONObject: message),
              let text = String(data: data, encoding: .utf8)
        else {
            return
        }

        do {
            try await task.send(.string(text))
        } catch {
            lastDisconnectReason = "send_failure"
            recordDiagnostic("send failed for \(topic):\(event)")
            await handleConnectionFailure()
        }
    }

    private func parseInbound(text: String) async {
        guard let data = text.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [Any],
              raw.count == 5,
              let topic = raw[2] as? String,
              let event = raw[3] as? String,
              let payload = raw[4] as? [String: Any]
        else {
            return
        }

        switch (topic.hasPrefix("chat:"), event) {
        case (true, "message:new"):
            if let chatID = payload["chat_id"] as? String,
               let messageID = payload["message_id"] as? String {
                continuation.yield(.messageNew(chatID: chatID, messageID: messageID))
            }
        case (true, _):
            continuation.yield(.raw(topic: topic, event: event, payload: payload.mapValues { AnyHashable(String(describing: $0)) }))
        case (false, "call:state"):
            continuation.yield(.callState(chatID: topic.replacingOccurrences(of: "call:", with: "")))
        case (false, "call:participant_state"):
            continuation.yield(.callParticipantState(chatID: topic.replacingOccurrences(of: "call:", with: "")))
        case (false, "call:signal"):
            continuation.yield(.callSignal(chatID: topic.replacingOccurrences(of: "call:", with: "")))
        default:
            continuation.yield(.raw(topic: topic, event: event, payload: payload.mapValues { AnyHashable(String(describing: $0)) }))
        }
    }

    private func transition(to state: RealtimeConnectionState) {
        guard connectionState != state else { return }
        connectionState = state
        recordDiagnostic("state -> \(state.rawValue)")
    }

    private func recordDiagnostic(_ line: String) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        diagnosticLog.append("[\(timestamp)] \(line)")
        if diagnosticLog.count > maxDiagnosticLogLines {
            diagnosticLog.removeFirst(diagnosticLog.count - maxDiagnosticLogLines)
        }
    }
}
