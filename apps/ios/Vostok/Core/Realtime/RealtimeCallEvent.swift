import Foundation

enum RealtimeCallEventKind: String {
    case state
    case participantState = "participant_state"
    case signal
}

struct RealtimeCallEvent {
    let chatID: String
    let kind: RealtimeCallEventKind

    init(chatID: String, kind: RealtimeCallEventKind) {
        self.chatID = chatID
        self.kind = kind
    }

    var userInfo: [AnyHashable: Any] {
        [
            Self.chatIDKey: chatID,
            Self.kindKey: kind.rawValue
        ]
    }

    init?(notification: Notification) {
        guard let userInfo = notification.userInfo,
              let chatID = userInfo[Self.chatIDKey] as? String,
              let kindRaw = userInfo[Self.kindKey] as? String,
              let kind = RealtimeCallEventKind(rawValue: kindRaw)
        else {
            return nil
        }

        self.chatID = chatID
        self.kind = kind
    }

    static let chatIDKey = "chat_id"
    static let kindKey = "event_kind"
}

extension Notification.Name {
    static let vostokCallEvent = Notification.Name("vostok.call.event")
}
