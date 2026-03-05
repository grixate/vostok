import XCTest
@testable import Vostok

final class ContactListViewModelTests: XCTestCase {
    @MainActor
    func testDeriveContactsExcludesCurrentUserAndDedupesCaseInsensitive() {
        let chats: [ChatDTO] = [
            .init(
                id: "c1",
                type: "direct",
                title: "alice",
                participantUsernames: ["alice", "bob", "Alice"],
                isSelfChat: false,
                latestMessageAt: nil,
                messageCount: 1
            ),
            .init(
                id: "c2",
                type: "group",
                title: "group",
                participantUsernames: ["charlie", "BOB", "dora"],
                isSelfChat: false,
                latestMessageAt: nil,
                messageCount: 2
            )
        ]

        let contacts = ContactListViewModel.deriveContacts(from: chats, currentUsername: "alice")

        XCTAssertEqual(contacts, ["bob", "charlie", "dora"])
    }

    @MainActor
    func testDeriveContactsReturnsSortedValues() {
        let chats: [ChatDTO] = [
            .init(
                id: "c1",
                type: "group",
                title: "group",
                participantUsernames: ["zoe", "ian", "amy"],
                isSelfChat: false,
                latestMessageAt: nil,
                messageCount: 1
            )
        ]

        let contacts = ContactListViewModel.deriveContacts(from: chats, currentUsername: nil)

        XCTAssertEqual(contacts, ["amy", "ian", "zoe"])
    }
}
