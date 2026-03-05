import Foundation
import XCTest
@testable import Vostok

final class RecipientEnvelopeBuilderTests: XCTestCase {
    override func tearDown() {
        super.tearDown()
        URLProtocolRecipientStub.reset()
    }

    func testUsesRecipientDevicesFromAPI() async throws {
        URLProtocolRecipientStub.enqueueJSON(
            statusCode: 200,
            object: [
                "recipient_devices": [
                    ["device_id": "device-2", "encryption_public_key": "k2"],
                    ["device_id": "device-1", "encryption_public_key": "k1"]
                ]
            ]
        )

        let client = makeAPIClient()
        let envelopes = await RecipientEnvelopeBuilder.build(
            apiClient: client,
            token: "token",
            chatID: "chat-1",
            fallbackDeviceID: "local-device"
        )

        XCTAssertEqual(envelopes.count, 2)
        XCTAssertNotNil(envelopes["device-1"])
        XCTAssertNotNil(envelopes["device-2"])
        XCTAssertNil(envelopes["local-device"])
    }

    func testFallsBackToLocalDeviceWhenLookupFails() async throws {
        URLProtocolRecipientStub.enqueueJSON(
            statusCode: 500,
            object: ["error": "internal", "message": "boom"]
        )

        let client = makeAPIClient()
        let envelopes = await RecipientEnvelopeBuilder.build(
            apiClient: client,
            token: "token",
            chatID: "chat-1",
            fallbackDeviceID: "local-device"
        )

        XCTAssertEqual(envelopes.count, 1)
        XCTAssertNotNil(envelopes["local-device"])
    }

    private func makeAPIClient() -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolRecipientStub.self]
        let session = URLSession(configuration: configuration)
        return APIClient(baseURL: URL(string: "https://example.test")!, session: session)
    }
}

private final class URLProtocolRecipientStub: URLProtocol {
    private static var queue: [(statusCode: Int, data: Data)] = []

    static func reset() {
        queue.removeAll()
    }

    static func enqueueJSON(statusCode: Int, object: [String: Any]) {
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [])) ?? Data()
        queue.append((statusCode, data))
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
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: next.statusCode, httpVersion: nil, headerFields: ["Content-Type": "application/json"])
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: next.data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
