import Foundation

enum RealtimeEvent: Equatable {
    case connected
    case disconnected
    case joined(topic: String)
    case messageNew(chatID: String, messageID: String)
    case callState(chatID: String)
    case callParticipantState(chatID: String)
    case callSignal(chatID: String)
    case raw(topic: String, event: String, payload: [String: AnyHashable])
}

enum RealtimeConnectionState: String, Equatable {
    case disconnected
    case connecting
    case connected
    case reconnecting
    case paused
}

struct RealtimeDiagnosticsSnapshot: Equatable {
    var connectionState: RealtimeConnectionState = .disconnected
    var reconnectAttempt: Int = 0
    var networkAvailable: Bool = true
    var lastDisconnectReason: String?
    var lastInboundAt: Date?
    var joinedTopics: [String] = []
    var recentLogLines: [String] = []
}

protocol PhoenixRealtimeClientProtocol {
    var events: AsyncStream<RealtimeEvent> { get }

    func connect(token: String) async
    func disconnect() async
    func pause() async
    func resume() async
    func updateNetworkAvailability(_ isAvailable: Bool) async
    func forceReconnect(reason: String) async
    func clearDiagnosticLog() async
    func snapshotDiagnostics() async -> RealtimeDiagnosticsSnapshot
    func join(topic: String) async
    func leave(topic: String) async
    func push(topic: String, event: String, payload: [String: Any]) async
}
