import Foundation

enum MediaTransferError: LocalizedError {
    case invalidUploadResponse
    case missingCiphertext
    case missingKey(uploadID: String)
    case digestMismatch(expected: String, actual: String)

    var errorDescription: String? {
        switch self {
        case .invalidUploadResponse:
            return "Upload response is missing required data."
        case .missingCiphertext:
            return "Server did not return media ciphertext."
        case let .missingKey(uploadID):
            return "No local decryption key found for upload \(uploadID)."
        case let .digestMismatch(expected, actual):
            return "Ciphertext digest mismatch (expected \(expected), got \(actual))."
        }
    }
}

struct UploadTransferResult {
    let upload: UploadDTO
    let keyMaterialBase64: String
    let ciphertextSha256: String
    let partCount: Int
    let plaintextByteSize: Int
    let ciphertextByteSize: Int
}

actor MediaTransferService {
    private let repository: MediaRepository
    private let partSize: Int
    private var uploadKeys: [String: Data] = [:]

    init(repository: MediaRepository, partSize: Int = 64 * 1024) {
        self.repository = repository
        self.partSize = max(1, partSize)
    }

    func uploadEncrypted(
        token: String,
        filename: String,
        contentType: String,
        mediaKind: String,
        plaintext: Data
    ) async throws -> UploadTransferResult {
        let sealed = try MediaCryptoBox.encrypt(plaintext)
        let partCount = max(1, Int(ceil(Double(sealed.ciphertext.count) / Double(partSize))))

        var upload = try await repository.createUpload(
            token: token,
            request: CreateUploadRequest(
                filename: filename,
                contentType: contentType,
                declaredByteSize: sealed.ciphertext.count,
                mediaKind: mediaKind,
                expectedPartCount: partCount
            )
        )

        uploadKeys[upload.id] = sealed.keyMaterial

        for index in 0..<partCount {
            let start = index * partSize
            let end = min(start + partSize, sealed.ciphertext.count)
            let chunk = sealed.ciphertext.subdata(in: start..<end)

            upload = try await repository.uploadPart(
                token: token,
                id: upload.id,
                request: UploadPartRequest(
                    chunk: chunk.base64EncodedString(),
                    partIndex: index,
                    partCount: partCount
                )
            )
        }

        upload = try await repository.completeUpload(
            token: token,
            id: upload.id,
            request: CompleteUploadRequest(ciphertextSha256: sealed.ciphertextSha256)
        )

        if let returnedDigest = upload.ciphertextSha256?.lowercased(),
           returnedDigest != sealed.ciphertextSha256 {
            throw MediaTransferError.digestMismatch(expected: sealed.ciphertextSha256, actual: returnedDigest)
        }

        return UploadTransferResult(
            upload: upload,
            keyMaterialBase64: sealed.keyMaterialBase64,
            ciphertextSha256: sealed.ciphertextSha256,
            partCount: partCount,
            plaintextByteSize: plaintext.count,
            ciphertextByteSize: sealed.ciphertext.count
        )
    }

    func uploadStatus(token: String, uploadID: String) async throws -> UploadDTO {
        try await repository.uploadStatus(token: token, id: uploadID)
    }

    func fetchAndDecrypt(token: String, uploadID: String, keyMaterialBase64: String? = nil) async throws -> Data {
        let media = try await repository.media(token: token, id: uploadID)

        guard let ciphertextBase64 = media.ciphertext,
              let ciphertext = Data(base64Encoded: ciphertextBase64) else {
            throw MediaTransferError.missingCiphertext
        }

        let providedKey = keyMaterialBase64.flatMap { Data(base64Encoded: $0) }
        guard let keyMaterial = providedKey ?? uploadKeys[uploadID] else {
            throw MediaTransferError.missingKey(uploadID: uploadID)
        }

        if let expectedDigest = media.ciphertextSha256?.lowercased() {
            let actualDigest = MediaCryptoBox.sha256Hex(ciphertext)
            if expectedDigest != actualDigest {
                throw MediaTransferError.digestMismatch(expected: expectedDigest, actual: actualDigest)
            }
        }

        return try MediaCryptoBox.decrypt(ciphertext: ciphertext, keyMaterial: keyMaterial)
    }
}
