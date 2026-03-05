import SwiftUI
import UIKit

@main
struct VostokApp: App {
    @UIApplicationDelegateAdaptor(VostokAppDelegate.self) private var appDelegate

    @StateObject private var state: AppState
    @StateObject private var pushManager = PushManager.shared

    init() {
        let container = AppContainer(environment: .load())
        _state = StateObject(wrappedValue: AppState(container: container))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                .environment(\.vostokContainer, state.container)
                .onOpenURL { url in
                    state.handleOpenURL(url)
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    guard let url = activity.webpageURL else { return }
                    state.handleOpenURL(url)
                }
                .onReceive(pushManager.$pendingChatNavigationID) { chatID in
                    guard let chatID else { return }
                    state.requestChatNavigation(chatID: chatID)
                    pushManager.consumePendingNavigation()
                }
                .onReceive(pushManager.$pendingAction) { action in
                    guard let action else { return }
                    Task { await processPendingPushActionIfPossible(action) }
                }
                .onChange(of: state.sessionState) { _ in
                    guard let action = pushManager.pendingAction else { return }
                    Task { await processPendingPushActionIfPossible(action) }
                }
                .task {
                    pushManager.registerForPushNotifications()
                    await state.startup()
                }
        }
    }

    @MainActor
    private func processPendingPushActionIfPossible(_ action: PushManager.PendingAction) async {
        let processed = await handlePendingPushAction(action)
        if processed {
            pushManager.consumePendingAction()
        }
    }

    @MainActor
    private func handlePendingPushAction(_ action: PushManager.PendingAction) async -> Bool {
        guard case let .authenticated(session) = state.sessionState else { return false }

        switch action {
        case let .reply(chatID, messageID, text):
            let recipientEnvelopes = await RecipientEnvelopeBuilder.build(
                apiClient: state.container.apiClient,
                token: session.token,
                chatID: chatID,
                fallbackDeviceID: session.deviceID
            )

            let request = CreateMessageRequest(
                clientID: UUID().uuidString,
                ciphertext: Data(text.utf8).base64EncodedString(),
                header: Data("{\"algorithm\":\"test\"}".utf8).base64EncodedString(),
                messageKind: "text",
                recipientEnvelopes: recipientEnvelopes,
                establishedSessionIDs: nil,
                replyToMessageID: messageID
            )

            do {
                _ = try await state.container.messageRepository.sendMessage(
                    token: session.token,
                    chatID: chatID,
                    request: request
                )
                state.requestChatNavigation(chatID: chatID)
                return true
            } catch {
                // Keep current behavior fail-safe; the app remains usable if quick-reply fails.
                return true
            }
        case .markRead:
            UIApplication.shared.applicationIconBadgeNumber = max(UIApplication.shared.applicationIconBadgeNumber - 1, 0)
            return true
        }
    }
}
