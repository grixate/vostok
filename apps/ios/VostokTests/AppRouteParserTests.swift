import XCTest
@testable import Vostok

final class AppRouteParserTests: XCTestCase {
    func testCustomSchemeChatURL() {
        let url = URL(string: "vostok://chat/chat-123")!
        XCTAssertEqual(AppRouteParser.route(from: url), .chat(chatID: "chat-123"))
    }

    func testHTTPSChatsURL() {
        let url = URL(string: "https://vostok.chat/chats/c42")!
        XCTAssertEqual(AppRouteParser.route(from: url), .chat(chatID: "c42"))
    }

    func testQueryChatIDURL() {
        let url = URL(string: "vostok://open?chat_id=abc-001")!
        XCTAssertEqual(AppRouteParser.route(from: url), .chat(chatID: "abc-001"))
    }

    func testVostokUserURL() {
        let url = URL(string: "vostok://user/alice")!
        XCTAssertEqual(AppRouteParser.route(from: url), .user(username: "alice"))
    }

    func testFederationUsernameUniversalLink() {
        let url = URL(string: "https://example.org/@bob")!
        XCTAssertEqual(AppRouteParser.route(from: url), .user(username: "bob"))
    }

    func testNotificationPayloadWithDirectChatID() {
        let payload: [AnyHashable: Any] = ["chat_id": "chat-direct"]
        XCTAssertEqual(
            AppRouteParser.route(fromNotificationUserInfo: payload),
            .chat(chatID: "chat-direct")
        )
    }

    func testNotificationPayloadWithNestedChatObject() {
        let payload: [AnyHashable: Any] = [
            "aps": ["alert": "Incoming message"],
            "meta": ["chat": ["id": "chat-nested"]]
        ]

        XCTAssertEqual(
            AppRouteParser.route(fromNotificationUserInfo: payload),
            .chat(chatID: "chat-nested")
        )
    }
}
