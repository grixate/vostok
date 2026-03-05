import XCTest
@testable import Vostok

final class PhoenixRealtimeParsingTests: XCTestCase {
    func testRealtimeEventEnumCoversMessageNew() {
        let event = RealtimeEvent.messageNew(chatID: "chat-1", messageID: "message-1")

        switch event {
        case let .messageNew(chatID, messageID):
            XCTAssertEqual(chatID, "chat-1")
            XCTAssertEqual(messageID, "message-1")
        default:
            XCTFail("Unexpected event")
        }
    }
}
