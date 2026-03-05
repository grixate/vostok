import Foundation

@MainActor
final class AuthViewModel: ObservableObject {
    @Published var username = ""
    @Published var errorMessage: String?
    @Published var isLoading = false

    private let apiClient: VostokAPIClientProtocol
    private let cryptoProvider: CryptoProviderProtocol

    init(apiClient: VostokAPIClientProtocol, cryptoProvider: CryptoProviderProtocol) {
        self.apiClient = apiClient
        self.cryptoProvider = cryptoProvider
    }

    func register(deviceName: String = "iPhone") async throws -> RegistrationResponse {
        isLoading = true
        defer { isLoading = false }

        let identity = try cryptoProvider.generateIdentity()

        let response = try await apiClient.register(
            request: RegisterRequest(
                username: username,
                deviceName: deviceName,
                deviceIdentityPublicKey: identity.deviceIdentityPublicKey,
                deviceEncryptionPublicKey: identity.deviceEncryptionPublicKey,
                signedPrekey: identity.signedPrekey,
                signedPrekeySignature: identity.signedPrekeySignature,
                oneTimePrekeys: identity.oneTimePrekeys
            )
        )

        _ = try await apiClient.publishPrekeys(
            token: response.session.token,
            request: PublishPrekeysRequest(
                signedPrekey: identity.signedPrekey,
                signedPrekeySignature: identity.signedPrekeySignature,
                oneTimePrekeys: identity.oneTimePrekeys,
                replaceOneTimePrekeys: true
            )
        )

        return response
    }

    func login(deviceID: String) async throws -> VerifyResponse {
        isLoading = true
        defer { isLoading = false }

        let challenge = try await apiClient.challenge(deviceID: deviceID)
        guard let challengeData = Data(base64Encoded: challenge.challenge) else {
            throw VostokAPIError.validation("Challenge was not base64")
        }

        let signature = try cryptoProvider.sign(challenge: challengeData)
        return try await apiClient.verify(request: VerifyRequest(deviceID: deviceID, challengeID: challenge.challengeID, signature: signature))
    }
}
