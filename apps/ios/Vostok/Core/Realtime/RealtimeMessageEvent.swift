import Foundation

struct RealtimeMessageEvent {
    let chatID: String
    let messageID: String?

    init(chatID: String, messageID: String?) {
        self.chatID = chatID
        self.messageID = messageID
    }

    var userInfo: [AnyHashable: Any] {
        var info: [AnyHashable: Any] = [Self.chatIDKey: chatID]
        if let messageID {
            info[Self.messageIDKey] = messageID
        }
        return info
    }

    init?(notification: Notification) {
        guard let userInfo = notification.userInfo,
              let chatID = userInfo[Self.chatIDKey] as? String
        else {
            return nil
        }

        self.chatID = chatID
        self.messageID = userInfo[Self.messageIDKey] as? String
    }

    static let chatIDKey = "chat_id"
    static let messageIDKey = "message_id"
}

extension Notification.Name {
    static let vostokMessageEvent = Notification.Name("vostok.message.event")
}
