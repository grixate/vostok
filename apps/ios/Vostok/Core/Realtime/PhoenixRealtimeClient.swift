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
        guard task == nil else { return }
        _ = await establishConnection(token: token, emitConnected: true)
        await rejoinStoredTopics()
    }

    func disconnect() async {
        authToken = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        teardownSocket(emitDisconnected: true)
        topics.removeAll()
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
            await sendPhoenix(topic: "phoenix", event: "heartbeat", payload: [:])
        }
    }

    private func receiveLoop() async {
        while !Task.isCancelled {
            guard let task else { return }
            do {
                let message = try await task.receive()
                if case let .string(text) = message {
                    await parseInbound(text: text)
                }
            } catch {
                await handleConnectionFailure()
                return
            }
        }
    }

    private func establishConnection(token: String, emitConnected: Bool) async -> Bool {
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

        if emitConnected {
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
            continuation.yield(.disconnected)
        }
    }

    private func handleConnectionFailure() async {
        teardownSocket(emitDisconnected: true)
        await scheduleReconnectIfNeeded()
    }

    private func scheduleReconnectIfNeeded() async {
        guard reconnectTask == nil, let token = authToken else { return }
        reconnectTask = Task { [token] in
            await self.reconnectLoop(token: token)
        }
    }

    private func reconnectLoop(token: String) async {
        defer { reconnectTask = nil }

        for attempt in 0..<5 {
            if Task.isCancelled || authToken == nil {
                return
            }

            let delay = min(2 << attempt, 30)
            try? await Task.sleep(for: .seconds(delay))

            guard task == nil else { return }
            let connected = await establishConnection(token: token, emitConnected: true)
            if connected {
                await rejoinStoredTopics()
                return
            }
        }
    }

    private func rejoinStoredTopics() async {
        guard task != nil else { return }
        for topic in topics.sorted() {
            await sendPhoenix(topic: topic, event: "phx_join", payload: [:])
            continuation.yield(.joined(topic: topic))
        }
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
}
