import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

        guard let bestAttemptContent else {
            contentHandler(request.content)
            return
        }

        let payload = PushNotificationPayloadParser.parse(userInfo: request.content.userInfo)

        if let sender = payload.senderName {
            bestAttemptContent.title = sender
        }
        if let chatTitle = payload.chatTitle {
            bestAttemptContent.subtitle = chatTitle
        }
        if let preview = payload.previewBody {
            bestAttemptContent.body = preview
        }
        if let chatID = payload.chatID {
            bestAttemptContent.threadIdentifier = chatID
        }

        bestAttemptContent.categoryIdentifier = PushNotificationConstants.messageCategoryIdentifier
        contentHandler(bestAttemptContent)
    }

    override func serviceExtensionTimeWillExpire() {
        if let contentHandler, let bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }
}
