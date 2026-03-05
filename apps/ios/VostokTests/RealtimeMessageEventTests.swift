import Foundation
import XCTest
@testable import Vostok

final class RealtimeMessageEventTests: XCTestCase {
    func testNotificationRoundTripWithMessageID() {
        let input = RealtimeMessageEvent(chatID: "chat-1", messageID: "msg-9")
        let notification = Notification(name: .vostokMessageEvent, object: nil, userInfo: input.userInfo)
        let parsed = RealtimeMessageEvent(notification: notification)

        XCTAssertEqual(parsed?.chatID, "chat-1")
        XCTAssertEqual(parsed?.messageID, "msg-9")
    }

    func testNotificationRoundTripWithoutMessageID() {
        let input = RealtimeMessageEvent(chatID: "chat-2", messageID: nil)
        let notification = Notification(name: .vostokMessageEvent, object: nil, userInfo: input.userInfo)
        let parsed = RealtimeMessageEvent(notification: notification)

        XCTAssertEqual(parsed?.chatID, "chat-2")
        XCTAssertNil(parsed?.messageID)
    }
}
