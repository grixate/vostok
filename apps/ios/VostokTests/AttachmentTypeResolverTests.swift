import XCTest
import UniformTypeIdentifiers
@testable import Vostok

final class AttachmentTypeResolverTests: XCTestCase {
    func testMediaKindInference() {
        XCTAssertEqual(AttachmentTypeResolver.mediaKind(for: .jpeg), "image")
        XCTAssertEqual(AttachmentTypeResolver.mediaKind(for: .mp3), "audio")
        XCTAssertEqual(AttachmentTypeResolver.mediaKind(for: .movie), "video")
        XCTAssertEqual(AttachmentTypeResolver.mediaKind(for: .plainText), "file")
        XCTAssertEqual(AttachmentTypeResolver.mediaKind(for: nil), "file")
    }

    func testDefaultContentTypes() {
        XCTAssertEqual(AttachmentTypeResolver.defaultContentType(for: "image"), "image/jpeg")
        XCTAssertEqual(AttachmentTypeResolver.defaultContentType(for: "video"), "video/quicktime")
        XCTAssertEqual(AttachmentTypeResolver.defaultContentType(for: "audio"), "audio/mp4")
        XCTAssertEqual(AttachmentTypeResolver.defaultContentType(for: "file"), "application/octet-stream")
    }

    func testDefaultExtensions() {
        XCTAssertEqual(AttachmentTypeResolver.defaultExtension(for: "image"), "jpg")
        XCTAssertEqual(AttachmentTypeResolver.defaultExtension(for: "video"), "mov")
        XCTAssertEqual(AttachmentTypeResolver.defaultExtension(for: "audio"), "m4a")
        XCTAssertEqual(AttachmentTypeResolver.defaultExtension(for: "file"), "bin")
    }
}
