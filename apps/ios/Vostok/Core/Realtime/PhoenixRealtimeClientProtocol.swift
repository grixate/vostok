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

protocol PhoenixRealtimeClientProtocol {
    var events: AsyncStream<RealtimeEvent> { get }

    func connect(token: String) async
    func disconnect() async
    func join(topic: String) async
    func leave(topic: String) async
    func push(topic: String, event: String, payload: [String: Any]) async
}
