import XCTest
@testable import Vostok

final class MediaCryptoTests: XCTestCase {
    func testEncryptDecryptRoundTrip() throws {
        let plaintext = Data("stage-9-media-roundtrip".utf8)

        let sealed = try MediaCryptoBox.encrypt(plaintext)
        XCTAssertEqual(sealed.ciphertextSha256, MediaCryptoBox.sha256Hex(sealed.ciphertext))

        let opened = try MediaCryptoBox.decrypt(ciphertext: sealed.ciphertext, keyMaterial: sealed.keyMaterial)
        XCTAssertEqual(opened, plaintext)
    }
}
