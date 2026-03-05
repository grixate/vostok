import CryptoKit
import Foundation

enum MediaCryptoError: LocalizedError {
    case invalidCiphertext

    var errorDescription: String? {
        switch self {
        case .invalidCiphertext:
            return "Ciphertext payload is invalid."
        }
    }
}

enum MediaCryptoBox {
    struct SealedPayload: Equatable {
        let ciphertext: Data
        let keyMaterial: Data
        let ciphertextSha256: String

        var keyMaterialBase64: String {
            keyMaterial.base64EncodedString()
        }
    }

    static func encrypt(_ plaintext: Data) throws -> SealedPayload {
        let key = SymmetricKey(size: .bits256)
        let sealed = try AES.GCM.seal(plaintext, using: key)

        guard let combined = sealed.combined else {
            throw MediaCryptoError.invalidCiphertext
        }

        let keyData = key.withUnsafeBytes { Data($0) }
        return SealedPayload(
            ciphertext: combined,
            keyMaterial: keyData,
            ciphertextSha256: sha256Hex(combined)
        )
    }

    static func decrypt(ciphertext: Data, keyMaterial: Data) throws -> Data {
        let key = SymmetricKey(data: keyMaterial)
        let sealed = try AES.GCM.SealedBox(combined: ciphertext)
        return try AES.GCM.open(sealed, using: key)
    }

    static func sha256Hex(_ data: Data) -> String {
        let digest = SHA256.hash(data: data)
        return digest.compactMap { String(format: "%02x", $0) }.joined()
    }
}
