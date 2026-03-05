import Foundation
import UniformTypeIdentifiers

enum AttachmentTypeResolver {
    static func mediaKind(for type: UTType?) -> String {
        guard let type else { return "file" }
        if type.conforms(to: .audio) { return "audio" }
        if type.conforms(to: .movie) || type.conforms(to: .video) { return "video" }
        if type.conforms(to: .image) { return "image" }
        return "file"
    }

    static func defaultContentType(for mediaKind: String) -> String {
        switch mediaKind {
        case "image":
            return "image/jpeg"
        case "video":
            return "video/quicktime"
        case "audio":
            return "audio/mp4"
        default:
            return "application/octet-stream"
        }
    }

    static func defaultExtension(for mediaKind: String) -> String {
        switch mediaKind {
        case "image":
            return "jpg"
        case "video":
            return "mov"
        case "audio":
            return "m4a"
        default:
            return "bin"
        }
    }
}
