import Foundation

protocol CryptoProviderProtocol {
    func generateIdentity() throws -> IdentityMaterial
    func sign(challenge: Data) throws -> String
    func generateOneTimePrekeys(count: Int) -> [String]
    func generateSignedPrekey() -> (prekey: String, signature: String)
}

struct IdentityMaterial: Equatable {
    let deviceIdentityPublicKey: String
    let deviceEncryptionPublicKey: String
    let signedPrekey: String
    let signedPrekeySignature: String
    let oneTimePrekeys: [String]
}
