import CryptoKit
import XCTest
@testable import Vostok

final class PushNotificationPayloadParserTests: XCTestCase {
    func testParsesDirectFields() {
        let payload: [AnyHashable: Any] = [
            "chat_id": "chat-1",
            "message_id": "msg-7",
            "sender_name": "alice",
            "chat_title": "General",
            "body": "hello"
        ]

        let parsed = PushNotificationPayloadParser.parse(userInfo: payload)
        XCTAssertEqual(parsed.chatID, "chat-1")
        XCTAssertEqual(parsed.messageID, "msg-7")
        XCTAssertEqual(parsed.senderName, "alice")
        XCTAssertEqual(parsed.chatTitle, "General")
        XCTAssertEqual(parsed.previewBody, "hello")
    }

    func testParsesNestedChatObjectAndAPSBody() {
        let payload: [AnyHashable: Any] = [
            "meta": ["chat": ["id": "chat-nested"]],
            "aps": ["alert": ["body": "fallback text"]]
        ]

        let parsed = PushNotificationPayloadParser.parse(userInfo: payload)
        XCTAssertEqual(parsed.chatID, "chat-nested")
        XCTAssertEqual(parsed.previewBody, "fallback text")
    }

    func testDecryptsCombinedAESGCMPreview() throws {
        let plaintext = "Encrypted preview"
        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        let sealed = try AES.GCM.seal(Data(plaintext.utf8), using: key)

        let payload: [AnyHashable: Any] = [
            "chat_id": "chat-2",
            "encrypted_preview_b64": sealed.combined!.base64EncodedString(),
            "preview_key_b64": keyData.base64EncodedString()
        ]

        let parsed = PushNotificationPayloadParser.parse(userInfo: payload)
        XCTAssertEqual(parsed.chatID, "chat-2")
        XCTAssertEqual(parsed.previewBody, plaintext)
    }
}
