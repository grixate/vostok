import XCTest
@testable import Vostok

final class VostokContractTests: XCTestCase {
    func testErrorEnvelopeDecodes() throws {
        let data = """
        {"error":"validation","message":"recipient_envelopes must include every active recipient device."}
        """.data(using: .utf8)!

        let envelope = try JSONDecoder().decode(ErrorEnvelope.self, from: data)
        XCTAssertEqual(envelope.error, "validation")
        XCTAssertTrue(envelope.message.contains("recipient_envelopes"))
    }

    func testMessageDTODecodes() throws {
        let data = """
        {
          "id":"m1",
          "chat_id":"c1",
          "client_id":"cli",
          "message_kind":"text",
          "sender_device_id":"d1",
          "inserted_at":"2026-03-05T00:00:00Z",
          "pinned_at":null,
          "header":"aGVhZGVy",
          "ciphertext":"Y2lwaGVy",
          "reply_to_message_id":null,
          "edited_at":null,
          "deleted_at":null,
          "recipient_device_ids":["d1"],
          "reactions":[],
          "recipient_envelope":"ZW52"
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(MessageDTO.self, from: data)
        XCTAssertEqual(message.id, "m1")
        XCTAssertEqual(message.chatID, "c1")
        XCTAssertEqual(message.messageKind, "text")
    }

    func testGroupMemberResponseDecodes() throws {
        let data = """
        {
          "member": {
            "user_id":"u1",
            "username":"alice",
            "role":"admin",
            "joined_at":"2026-03-05T00:00:00Z"
          }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(GroupMemberResponse.self, from: data)
        XCTAssertEqual(response.member.userID, "u1")
        XCTAssertEqual(response.member.role, "admin")
    }

    func testFederationPeerResponseDecodes() throws {
        let data = """
        {
          "peer": {
            "id":"p1",
            "domain":"peer.example",
            "display_name":"Peer Example",
            "status":"active",
            "trust_state":"trusted",
            "last_error":null,
            "last_seen_at":"2026-03-05T00:00:00Z",
            "trusted_at":"2026-03-05T00:00:00Z",
            "inserted_at":"2026-03-05T00:00:00Z",
            "updated_at":"2026-03-05T00:00:00Z"
          }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(FederationPeerResponse.self, from: data)
        XCTAssertEqual(response.peer.id, "p1")
        XCTAssertEqual(response.peer.trustState, "trusted")
    }

    func testFederationDeliveryResponseDecodes() throws {
        let data = """
        {
          "delivery": {
            "id":"j1",
            "peer_id":"p1",
            "direction":"outbound",
            "event_type":"message.new",
            "status":"queued",
            "payload":{"seq":1,"content":"hello"},
            "remote_delivery_id":null,
            "attempt_count":0,
            "available_at":"2026-03-05T00:00:00Z",
            "last_attempted_at":null,
            "delivered_at":null,
            "last_error":null,
            "inserted_at":"2026-03-05T00:00:00Z",
            "updated_at":"2026-03-05T00:00:00Z"
          }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(FederationDeliveryResponse.self, from: data)
        XCTAssertEqual(response.delivery.id, "j1")
        XCTAssertEqual(response.delivery.payload["content"], .string("hello"))
    }
}
