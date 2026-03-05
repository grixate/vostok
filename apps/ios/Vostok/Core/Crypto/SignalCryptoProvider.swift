import CryptoKit
import Foundation
import Security

final class SignalCryptoProvider: CryptoProviderProtocol {
    private let keychainService = "chat.vostok.ios.crypto"
    private let signingAccount = "identity.signing.private"
    private let encryptionAccount = "identity.encryption.private"
    private let prekeyCounterAccount = "identity.prekey.counter"

    func generateIdentity() throws -> IdentityMaterial {
        let signingKey = try loadOrCreateSigningKey()
        let encryptionKey = try loadOrCreateEncryptionKey()
        let signedPrekeyTuple = try generateSignedPrekeyWithSigningKey(signingKey)
        let oneTime = generateOneTimePrekeysWithKey(encryptionKey: encryptionKey, count: 100)

        return IdentityMaterial(
            deviceIdentityPublicKey: signingKey.publicKey.rawRepresentation.base64EncodedString(),
            deviceEncryptionPublicKey: encryptionKey.publicKey.rawRepresentation.base64EncodedString(),
            signedPrekey: signedPrekeyTuple.prekey,
            signedPrekeySignature: signedPrekeyTuple.signature,
            oneTimePrekeys: oneTime
        )
    }

    func sign(challenge: Data) throws -> String {
        let signingKey = try loadOrCreateSigningKey()
        let signature = try signingKey.signature(for: challenge)
        return Data(signature).base64EncodedString()
    }

    func generateOneTimePrekeys(count: Int) -> [String] {
        guard let encryptionKey = try? loadOrCreateEncryptionKey() else { return [] }
        return generateOneTimePrekeysWithKey(encryptionKey: encryptionKey, count: count)
    }

    func generateSignedPrekey() -> (prekey: String, signature: String) {
        guard let signingKey = try? loadOrCreateSigningKey(),
              let tuple = try? generateSignedPrekeyWithSigningKey(signingKey) else {
            return ("", "")
        }
        return tuple
    }

    private func generateSignedPrekeyWithSigningKey(_ signingKey: Curve25519.Signing.PrivateKey) throws -> (prekey: String, signature: String) {
        let keyMaterial = deriveMaterial(seed: "signed-prekey", count: 1)
        let prekey = keyMaterial.first ?? Data()
        let signature = try signingKey.signature(for: prekey)
        return (prekey.base64EncodedString(), Data(signature).base64EncodedString())
    }

    private func generateOneTimePrekeysWithKey(
        encryptionKey: Curve25519.KeyAgreement.PrivateKey,
        count: Int
    ) -> [String] {
        let seed = encryptionKey.rawRepresentation.base64EncodedString()
        return deriveMaterial(seed: "one-time:\(seed)", count: count).map { $0.base64EncodedString() }
    }

    private func deriveMaterial(seed: String, count: Int) -> [Data] {
        let normalizedCount = max(1, count)
        let counter = loadPrekeyCounter()
        let base = SymmetricKey(data: SHA256.hash(data: Data(seed.utf8)))
        var output: [Data] = []

        for idx in 0..<normalizedCount {
            let value = counter + idx
            let message = Data("vostok:\(value)".utf8)
            let digest = HMAC<SHA256>.authenticationCode(for: message, using: base)
            output.append(Data(digest))
        }

        savePrekeyCounter(counter + normalizedCount)
        return output
    }

    private func loadOrCreateSigningKey() throws -> Curve25519.Signing.PrivateKey {
        if let data = loadKeychain(account: signingAccount) {
            return try Curve25519.Signing.PrivateKey(rawRepresentation: data)
        }
        let key = Curve25519.Signing.PrivateKey()
        saveKeychain(account: signingAccount, data: key.rawRepresentation)
        return key
    }

    private func loadOrCreateEncryptionKey() throws -> Curve25519.KeyAgreement.PrivateKey {
        if let data = loadKeychain(account: encryptionAccount) {
            return try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: data)
        }
        let key = Curve25519.KeyAgreement.PrivateKey()
        saveKeychain(account: encryptionAccount, data: key.rawRepresentation)
        return key
    }

    private func loadPrekeyCounter() -> Int {
        guard let data = loadKeychain(account: prekeyCounterAccount),
              let value = String(data: data, encoding: .utf8),
              let counter = Int(value) else {
            return 1
        }
        return max(1, counter)
    }

    private func savePrekeyCounter(_ value: Int) {
        saveKeychain(account: prekeyCounterAccount, data: Data(String(value).utf8))
    }

    private func loadKeychain(account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else { return nil }
        return item as? Data
    }

    private func saveKeychain(account: String, data: Data) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account
        ]

        SecItemDelete(query as CFDictionary)

        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(insert as CFDictionary, nil)
    }
}
