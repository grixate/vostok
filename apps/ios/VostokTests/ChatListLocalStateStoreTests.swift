import Foundation
import XCTest
@testable import Vostok

final class ChatListLocalStateStoreTests: XCTestCase {
    private var suiteName: String!
    private var userDefaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "ChatListLocalStateStoreTests.\(UUID().uuidString)"
        userDefaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        userDefaults?.removePersistentDomain(forName: suiteName)
        userDefaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testLoadReturnsEmptyWhenNoStoredData() {
        let store = ChatListLocalStateStore(userDefaults: userDefaults, storageKey: "state")

        XCTAssertEqual(store.load(), .empty)
    }

    func testSaveAndLoadRoundTrip() {
        let store = ChatListLocalStateStore(userDefaults: userDefaults, storageKey: "state")
        let state = ChatListLocalState(
            unreadCounts: ["chat-1": 3, "chat-2": 1],
            mutedChatIDs: ["chat-1"],
            pinnedChatIDs: ["chat-2", "chat-1"],
            archivedChatIDs: ["chat-3"],
            lastMessagePreviews: [:]
        )

        store.save(state)

        XCTAssertEqual(store.load(), state)
    }
}
