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

    func testReconnectDelayGrowsAndCaps() {
        let client = PhoenixRealtimeClient(socketURL: URL(string: "ws://localhost/socket/websocket")!)
        let delays = (1...6).map { client.reconnectDelaySeconds(attempt: $0) }

        XCTAssertEqual(delays, [2, 4, 8, 16, 30, 30])
    }

    func testOrderedTopicsForRejoinSortsDeterministically() {
        let client = PhoenixRealtimeClient(socketURL: URL(string: "ws://localhost/socket/websocket")!)
        let ordered = client.orderedTopicsForRejoin(["chat:2", "user:1", "chat:1"])

        XCTAssertEqual(ordered, ["chat:1", "chat:2", "user:1"])
    }

    func testDropDecisionPausedStaysPausedWithoutReconnect() {
        let client = PhoenixRealtimeClient(socketURL: URL(string: "ws://localhost/socket/websocket")!)

        XCTAssertEqual(client.stateAfterSocketDrop(isPaused: true, networkAvailable: true, hasAuthToken: true), .paused)
        XCTAssertFalse(client.shouldScheduleReconnectAfterDrop(isPaused: true, networkAvailable: true, hasAuthToken: true))
    }

    func testDropDecisionAuthenticatedReconnects() {
        let client = PhoenixRealtimeClient(socketURL: URL(string: "ws://localhost/socket/websocket")!)

        XCTAssertEqual(client.stateAfterSocketDrop(isPaused: false, networkAvailable: true, hasAuthToken: true), .reconnecting)
        XCTAssertTrue(client.shouldScheduleReconnectAfterDrop(isPaused: false, networkAvailable: true, hasAuthToken: true))
    }

    func testDropDecisionOfflineDoesNotReconnect() {
        let client = PhoenixRealtimeClient(socketURL: URL(string: "ws://localhost/socket/websocket")!)

        XCTAssertEqual(client.stateAfterSocketDrop(isPaused: false, networkAvailable: false, hasAuthToken: true), .disconnected)
        XCTAssertFalse(client.shouldScheduleReconnectAfterDrop(isPaused: false, networkAvailable: false, hasAuthToken: true))
    }

    func testStaleDetectionTriggersOnlyAfterThreshold() {
        let client = PhoenixRealtimeClient(socketURL: URL(string: "ws://localhost/socket/websocket")!)
        let now = Date()

        XCTAssertFalse(client.shouldMarkSocketStale(lastInboundAt: now.addingTimeInterval(-89), now: now))
        XCTAssertTrue(client.shouldMarkSocketStale(lastInboundAt: now.addingTimeInterval(-91), now: now))
    }
}
