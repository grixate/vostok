import Foundation

struct AttachmentCipherPayload: Codable {
    let uploadID: String
    let filename: String
    let mediaKind: String
    let contentType: String
    let keyMaterialBase64: String
    let ciphertextSha256: String?
    let byteSize: Int?

    enum CodingKeys: String, CodingKey {
        case uploadID = "upload_id"
        case filename
        case mediaKind = "media_kind"
        case contentType = "content_type"
        case keyMaterialBase64 = "key_material_base64"
        case ciphertextSha256 = "ciphertext_sha256"
        case byteSize = "byte_size"
    }
}
