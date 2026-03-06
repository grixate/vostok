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

    func testDatabaseReopenPreservesSessionPayloadAndSenderKeys() async throws {
        let database = try makeTestDatabase()
        database.saveSessionRecord(
            .init(
                sessionID: "session-1",
                chatID: "chat-crypto",
                peerDeviceID: "device-2",
                status: "active",
                signalAddressName: "device-2",
                signalAddressDeviceID: 77,
                sessionPayload: Data("serialized-session".utf8).base64EncodedString(),
                updatedAt: "2026-03-06T00:00:00Z"
            )
        )
        database.saveSenderKeyRecords([
            .init(
                id: "sender-key-1",
                chatID: "chat-crypto",
                ownerDeviceID: "device-1",
                recipientDeviceID: "device-2",
                keyID: "key-1",
                senderKeyEpoch: 1,
                algorithm: "sender-key.v1",
                status: "active",
                wrappedSenderKey: Data("wrapped".utf8).base64EncodedString(),
                updatedAt: "2026-03-06T00:00:00Z"
            )
        ])

        let reopened = try VostokDatabase(databaseURL: tempDatabaseURL, passphrase: "test-passphrase")
        let restoredSession = reopened.sessionRecord(chatID: "chat-crypto", peerDeviceID: "device-2")
        let restoredSenderKeys = reopened.senderKeyRecords(chatID: "chat-crypto")

        XCTAssertEqual(restoredSession?.sessionID, "session-1")
        XCTAssertEqual(restoredSession?.signalAddressDeviceID, 77)
        XCTAssertEqual(restoredSenderKeys.count, 1)
        XCTAssertEqual(restoredSenderKeys.first?.keyID, "key-1")
    }

    func testSignalRuntimeDistributesAndCachesSenderKeys() async throws {
        URLProtocolQueueStub.enqueueJSON(statusCode: 200, object: ["sender_keys": []])
        URLProtocolQueueStub.enqueueJSON(
            statusCode: 200,
            object: [
                "sender_keys": [
                    [
                        "id": "sender-key-1",
                        "chat_id": "chat-group",
                        "owner_device_id": "device-1",
                        "recipient_device_id": "device-2",
                        "key_id": "key-1",
                        "sender_key_epoch": 1,
                        "algorithm": "sender-key.v1",
                        "status": "active",
                        "wrapped_sender_key": Data("wrapped-2".utf8).base64EncodedString()
                    ],
                    [
                        "id": "sender-key-2",
                        "chat_id": "chat-group",
                        "owner_device_id": "device-1",
                        "recipient_device_id": "device-3",
                        "key_id": "key-1",
                        "sender_key_epoch": 1,
                        "algorithm": "sender-key.v1",
                        "status": "active",
                        "wrapped_sender_key": Data("wrapped-3".utf8).base64EncodedString()
                    ]
                ]
            ]
        )

        let session = makeSession()
        let apiClient = APIClient(baseURL: URL(string: "https://example.test")!, session: session)
        let database = try makeTestDatabase()
        let runtime = SignalSessionRuntime(apiClient: apiClient, database: database)

        let keys = await runtime.ensureGroupSenderKeys(
            token: "token",
            chatID: "chat-group",
            ownerDeviceID: "device-1",
            recipientDeviceIDs: ["device-2", "device-3"]
        )

        XCTAssertEqual(keys.count, 2)
        XCTAssertEqual(database.senderKeyRecords(chatID: "chat-group").count, 2)
    }

    func testMarkChatReadPostsReadStateRequest() async throws {
        URLProtocolQueueStub.enqueueJSON(
            statusCode: 200,
            object: [
                "read_state": [
                    "chat_id": "chat-1",
                    "device_id": "device-1",
                    "last_read_message_id": "msg-99",
                    "read_at": "2026-03-06T00:00:00Z"
                ]
            ]
        )

        let session = makeSession()
        let apiClient = APIClient(baseURL: URL(string: "https://example.test")!, session: session)
        let database = try makeTestDatabase()
        let repository = InMemoryMessageRepository(apiClient: apiClient, database: database)

        try await repository.markChatRead(token: "token", chatID: "chat-1", lastReadMessageID: "msg-99")

        let request = try XCTUnwrap(URLProtocolQueueStub.recordedRequests.last)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/chats/chat-1/read")
        let body = try XCTUnwrap(httpBodyData(for: request))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["last_read_message_id"] as? String, "msg-99")
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

    private func httpBodyData(for request: URLRequest) -> Data? {
        if let body = request.httpBody {
            return body
        }

        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }

        let bufferSize = 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        var data = Data()
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufferSize)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data.isEmpty ? nil : data
    }
}

private final class URLProtocolQueueStub: URLProtocol {
    private static var queue: [Result<(Int, Data), Error>] = []
    static var recordedRequests: [URLRequest] = []

    static func reset() {
        queue.removeAll()
        recordedRequests.removeAll()
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
        Self.recordedRequests.append(request)
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
