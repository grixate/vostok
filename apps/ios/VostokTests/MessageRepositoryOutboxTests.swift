import Foundation
import XCTest
@testable import Vostok

final class MessageRepositoryOutboxTests: XCTestCase {
    private var tempDatabaseURL: URL?

    override func tearDown() {
        super.tearDown()
        URLProtocolQueueStub.reset()
        if let tempDatabaseURL {
            try? FileManager.default.removeItem(at: tempDatabaseURL)
        }
    }

    func testTransportFailureQueuesAndFlushDedupesByClientID() async throws {
        let session = makeSession()
        let apiClient = APIClient(baseURL: URL(string: "https://example.test")!, session: session)
        let database = try makeTestDatabase()
        let repository = InMemoryMessageRepository(apiClient: apiClient, database: database)

        let clientID = "client-1"
        let request = CreateMessageRequest(
            clientID: clientID,
            ciphertext: Data("hello".utf8).base64EncodedString(),
            header: Data("{\"algorithm\":\"test\"}".utf8).base64EncodedString(),
            messageKind: "text",
            recipientEnvelopes: ["device-1": Data("envelope".utf8).base64EncodedString()],
            establishedSessionIDs: nil,
            replyToMessageID: nil
        )

        URLProtocolQueueStub.enqueueFailure(URLError(.notConnectedToInternet))

        let pending = try await repository.sendMessage(token: "token", chatID: "chat-1", request: request)
        XCTAssertEqual(pending.id, "pending:\(clientID)")
        XCTAssertEqual(pending.clientID, clientID)

        URLProtocolQueueStub.enqueueJSON(statusCode: 200, object: messageResponsePayload(id: "server-1", clientID: clientID))
        await repository.flushPendingOutgoing(token: "token", chatID: "chat-1")

        URLProtocolQueueStub.enqueueJSON(statusCode: 200, object: messagesResponsePayload(id: "server-1", clientID: clientID))
        let messages = try await repository.fetchMessages(token: "token", chatID: "chat-1")

        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages.first?.id, "server-1")
        XCTAssertEqual(messages.first?.clientID, clientID)
    }

    private func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolQueueStub.self]
        return URLSession(configuration: configuration)
    }

    private func makeTestDatabase() throws -> VostokDatabase {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("vostok-tests", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let fileURL = directory.appendingPathComponent("\(UUID().uuidString).sqlite")
        tempDatabaseURL = fileURL
        return try VostokDatabase(databaseURL: fileURL, passphrase: "test-passphrase")
    }

    private func messageResponsePayload(id: String, clientID: String) -> [String: Any] {
        [
            "message": messagePayload(id: id, clientID: clientID)
        ]
    }

    private func messagesResponsePayload(id: String, clientID: String) -> [String: Any] {
        [
            "messages": [messagePayload(id: id, clientID: clientID)]
        ]
    }

    private func messagePayload(id: String, clientID: String) -> [String: Any] {
        [
            "id": id,
            "chat_id": "chat-1",
            "client_id": clientID,
            "message_kind": "text",
            "sender_device_id": "device-1",
            "inserted_at": "2026-03-05T00:00:00Z",
            "pinned_at": NSNull(),
            "header": Data("{\"algorithm\":\"test\"}".utf8).base64EncodedString(),
            "ciphertext": Data("hello".utf8).base64EncodedString(),
            "reply_to_message_id": NSNull(),
            "edited_at": NSNull(),
            "deleted_at": NSNull(),
            "recipient_device_ids": ["device-1"],
            "reactions": [],
            "recipient_envelope": NSNull()
        ]
    }
}

private final class URLProtocolQueueStub: URLProtocol {
    private static var queue: [Result<(Int, Data), Error>] = []

    static func reset() {
        queue.removeAll()
    }

    static func enqueueFailure(_ error: Error) {
        queue.append(.failure(error))
    }

    static func enqueueJSON(statusCode: Int, object: [String: Any]) {
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [])) ?? Data()
        queue.append(.success((statusCode, data)))
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "example.test"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard !Self.queue.isEmpty else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        let next = Self.queue.removeFirst()
        switch next {
        case let .failure(error):
            client?.urlProtocol(self, didFailWithError: error)
        case let .success((statusCode, data)):
            guard let url = request.url,
                  let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: nil, headerFields: ["Content-Type": "application/json"])
            else {
                client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
                return
            }

            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}
