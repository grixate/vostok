import Foundation
import UniformTypeIdentifiers

struct MediaTransferItem: Identifiable, Equatable {
    let id: String
    let upload: UploadDTO
    let keyMaterialBase64: String?

    var status: String {
        upload.status
    }
}

@MainActor
final class MediaViewModel: ObservableObject {
    @Published var uploads: [MediaTransferItem] = []
    @Published var selectedUploadID = ""
    @Published var manualKeyMaterialBase64 = ""
    @Published var decryptedPreview = ""
    @Published var noteText = ""
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var lastResultSummary: String?

    private let transferService: MediaTransferService

    init(transferService: MediaTransferService) {
        self.transferService = transferService
    }

    func uploadNote(token: String) async {
        let trimmed = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = trimmed.isEmpty ? "Vostok note \(ISO8601DateFormatter().string(from: Date()))" : trimmed
        let data = Data(text.utf8)
        await uploadData(
            token: token,
            filename: "note-\(Int(Date().timeIntervalSince1970)).txt",
            contentType: "text/plain",
            kind: "file",
            plaintext: data
        )
    }

    func uploadFile(token: String, fileURL: URL) async {
        let hasScopedAccess = fileURL.startAccessingSecurityScopedResource()
        defer {
            if hasScopedAccess {
                fileURL.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let resourceValues = try? fileURL.resourceValues(forKeys: [.contentTypeKey])
            let type = resourceValues?.contentType ?? UTType(filenameExtension: fileURL.pathExtension)
            let mediaKind = AttachmentTypeResolver.mediaKind(for: type)
            let contentType = type?.preferredMIMEType ?? AttachmentTypeResolver.defaultContentType(for: mediaKind)
            let filename = fileURL.lastPathComponent.isEmpty
                ? "\(mediaKind)-\(Int(Date().timeIntervalSince1970)).\(AttachmentTypeResolver.defaultExtension(for: mediaKind))"
                : fileURL.lastPathComponent

            await uploadData(
                token: token,
                filename: filename,
                contentType: contentType,
                kind: mediaKind,
                plaintext: data
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func uploadDataBlob(token: String, data: Data, filename: String, contentType: String, mediaKind: String) async {
        await uploadData(
            token: token,
            filename: filename,
            contentType: contentType,
            kind: mediaKind,
            plaintext: data
        )
    }

    func refreshUploadStatus(token: String) async {
        let uploadID = selectedUploadID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !uploadID.isEmpty else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            let upload = try await transferService.uploadStatus(token: token, uploadID: uploadID)
            upsertUpload(upload, keyMaterialBase64: existingKey(for: upload.id))
            lastResultSummary = "Upload \(upload.id) is \(upload.status)."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func fetchAndDecrypt(token: String) async {
        let uploadID = selectedUploadID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !uploadID.isEmpty else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            let manualKey = manualKeyMaterialBase64.trimmingCharacters(in: .whitespacesAndNewlines)
            let keyToUse = manualKey.isEmpty ? nil : manualKey
            let plaintext = try await transferService.fetchAndDecrypt(token: token, uploadID: uploadID, keyMaterialBase64: keyToUse)
            decryptedPreview = previewString(for: plaintext)
            lastResultSummary = "Decrypted \(plaintext.count) bytes from \(uploadID)."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func uploadData(
        token: String,
        filename: String,
        contentType: String,
        kind: String,
        plaintext: Data
    ) async {
        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await transferService.uploadEncrypted(
                token: token,
                filename: filename,
                contentType: contentType,
                mediaKind: kind,
                plaintext: plaintext
            )

            upsertUpload(result.upload, keyMaterialBase64: result.keyMaterialBase64)
            selectedUploadID = result.upload.id
            manualKeyMaterialBase64 = result.keyMaterialBase64
            decryptedPreview = previewString(for: plaintext)
            lastResultSummary =
                "Uploaded \(result.plaintextByteSize) bytes in \(result.partCount) parts; digest \(result.ciphertextSha256)."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func upsertUpload(_ upload: UploadDTO, keyMaterialBase64: String?) {
        let item = MediaTransferItem(id: upload.id, upload: upload, keyMaterialBase64: keyMaterialBase64)
        if let index = uploads.firstIndex(where: { $0.id == upload.id }) {
            let existingKey = uploads[index].keyMaterialBase64
            uploads[index] = MediaTransferItem(
                id: upload.id,
                upload: upload,
                keyMaterialBase64: keyMaterialBase64 ?? existingKey
            )
        } else {
            uploads.insert(item, at: 0)
        }
    }

    private func existingKey(for uploadID: String) -> String? {
        uploads.first(where: { $0.id == uploadID })?.keyMaterialBase64
    }

    private func previewString(for data: Data) -> String {
        if let text = String(data: data, encoding: .utf8) {
            return text
        }

        let prefix = data.prefix(32).map { String(format: "%02x", $0) }.joined(separator: " ")
        return "Binary (\(data.count) bytes) prefix: \(prefix)"
    }
}
