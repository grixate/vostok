import Foundation
import UserNotifications
import UIKit

@MainActor
final class PushManager: NSObject, ObservableObject {
    static let shared = PushManager()

    enum PendingAction: Equatable {
        case reply(chatID: String, messageID: String?, text: String)
        case markRead(chatID: String, messageID: String?)
    }

    @Published private(set) var apnsToken: String?
    @Published private(set) var authorizationGranted = false
    @Published private(set) var registrationError: String?
    @Published private(set) var pendingChatNavigationID: String?
    @Published private(set) var pendingAction: PendingAction?

    func registerForPushNotifications() {
        configureNotificationCategories()
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            DispatchQueue.main.async {
                self.authorizationGranted = granted
                self.registrationError = error?.localizedDescription
            }

            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    func didRegisterForRemoteNotifications(deviceToken: Data) {
        apnsToken = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        registrationError = nil
    }

    func didFailToRegister(error: Error) {
        registrationError = error.localizedDescription
    }

    func handleRemoteNotification(userInfo: [AnyHashable: Any]) {
        guard let route = AppRouteParser.route(fromNotificationUserInfo: userInfo) else { return }
        switch route {
        case let .chat(chatID):
            pendingChatNavigationID = chatID
        case .user:
            break
        }
    }

    func handleNotificationResponse(_ response: UNNotificationResponse) {
        let payload = PushNotificationPayloadParser.parse(userInfo: response.notification.request.content.userInfo)

        switch response.actionIdentifier {
        case UNNotificationDefaultActionIdentifier:
            if let chatID = payload.chatID {
                pendingChatNavigationID = chatID
            }
        case PushNotificationConstants.replyActionIdentifier:
            guard let chatID = payload.chatID,
                  let textResponse = response as? UNTextInputNotificationResponse
            else {
                return
            }

            let text = textResponse.userText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return }
            pendingAction = .reply(chatID: chatID, messageID: payload.messageID, text: text)
        case PushNotificationConstants.markReadActionIdentifier:
            guard let chatID = payload.chatID else { return }
            pendingAction = .markRead(chatID: chatID, messageID: payload.messageID)
        default:
            break
        }
    }

    func handleBackgroundRemoteNotification(userInfo: [AnyHashable: Any]) {
        _ = PushNotificationPayloadParser.parse(userInfo: userInfo)
    }

    func consumePendingNavigation() {
        pendingChatNavigationID = nil
    }

    func consumePendingAction() {
        pendingAction = nil
    }

    private func configureNotificationCategories() {
        let replyAction = UNTextInputNotificationAction(
            identifier: PushNotificationConstants.replyActionIdentifier,
            title: "Reply",
            options: [.authenticationRequired],
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Message"
        )

        let markReadAction = UNNotificationAction(
            identifier: PushNotificationConstants.markReadActionIdentifier,
            title: "Mark as Read",
            options: []
        )

        let category = UNNotificationCategory(
            identifier: PushNotificationConstants.messageCategoryIdentifier,
            actions: [replyAction, markReadAction],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )

        UNUserNotificationCenter.current().setNotificationCategories([category])
    }
}
