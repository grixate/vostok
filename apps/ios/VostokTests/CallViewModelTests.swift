import XCTest
@testable import Vostok

final class CallViewModelTests: XCTestCase {
    @MainActor
    func testRefreshActiveHandlesNotFoundAsNoActiveCall() async {
        let repository = FakeCallRepository()
        repository.activeCallResult = .failure(VostokAPIError.notFound("No active call"))
        let viewModel = CallViewModel(repository: repository)

        await viewModel.refreshActive(token: "token", chatID: "chat-1")

        XCTAssertNil(viewModel.activeCall)
        XCTAssertNil(viewModel.lastError)
        XCTAssertFalse(viewModel.canJoinCall)
        XCTAssertTrue(viewModel.canStartCall)
    }

    @MainActor
    func testStartCallUpdatesActions() async {
        let repository = FakeCallRepository()
        let call = CallDTO(id: "call-1", chatID: "chat-1", status: "created", mode: "voice")
        repository.createCallResult = .success(call)
        repository.callStateResult = .success(call)
        repository.activeCallResult = .success(call)

        let viewModel = CallViewModel(repository: repository)
        await viewModel.start(token: "token", chatID: "chat-1", mode: "voice")

        XCTAssertEqual(viewModel.activeCall?.id, "call-1")
        XCTAssertTrue(viewModel.canJoinCall)
        XCTAssertTrue(viewModel.canEndCall)
        XCTAssertFalse(viewModel.canStartCall)
        viewModel.stopPolling()
    }
}

private final class FakeCallRepository: CallRepository {
    var createCallResult: Result<CallDTO, Error> = .failure(VostokAPIError.notFound("not-set"))
    var activeCallResult: Result<CallDTO, Error> = .failure(VostokAPIError.notFound("not-set"))
    var callStateResult: Result<CallDTO, Error> = .failure(VostokAPIError.notFound("not-set"))

    private let endpoint = WebRTCEndpointResponse(
        endpoint: EndpointStateDTO(endpointID: "endpoint-1", exists: true, pendingMediaEventCount: 0),
        mediaEvents: []
    )

    private let turn = TurnCredentialsResponse.TurnDTO(
        username: "turn-user",
        password: "turn-pass",
        ttlSeconds: 600,
        expiresAt: "2026-03-05T00:00:00Z",
        uris: ["turn:example.org:3478"]
    )

    func createCall(token: String, chatID: String, mode: String) async throws -> CallDTO {
        try createCallResult.get()
    }

    func activeCall(token: String, chatID: String) async throws -> CallDTO {
        try activeCallResult.get()
    }

    func callState(token: String, callID: String) async throws -> CallDTO {
        try callStateResult.get()
    }

    func provisionEndpoint(token: String, callID: String) async throws -> WebRTCEndpointResponse {
        endpoint
    }

    func endpointState(token: String, callID: String) async throws -> WebRTCEndpointResponse {
        endpoint
    }

    func joinCall(token: String, callID: String, trackKind: String) async throws -> CallDTO {
        try callStateResult.get()
    }

    func callSignals(token: String, callID: String) async throws -> [CallSignalDTO] {
        []
    }

    func emitSignal(
        token: String,
        callID: String,
        signalType: String,
        payload: String,
        targetDeviceID: String?
    ) async throws -> CallSignalDTO {
        CallSignalDTO(
            id: "signal-1",
            callID: callID,
            signalType: signalType,
            fromDeviceID: "device-1",
            targetDeviceID: targetDeviceID,
            payload: payload,
            insertedAt: "2026-03-05T00:00:00Z"
        )
    }

    func pushEndpointMediaEvent(token: String, callID: String, event: String) async throws -> WebRTCEndpointResponse {
        endpoint
    }

    func turnCredentials(token: String) async throws -> TurnCredentialsResponse.TurnDTO {
        turn
    }

    func leaveCall(token: String, callID: String) async throws -> CallDTO {
        try callStateResult.get()
    }

    func endCall(token: String, callID: String) async throws -> CallDTO {
        try callStateResult.get()
    }

    func pollEndpoint(token: String, callID: String) async throws -> WebRTCEndpointResponse {
        endpoint
    }
}
