import Foundation

struct AppEnvironment {
    let baseURL: URL
    let socketURL: URL
    let instanceLabel: String

    static func load() -> AppEnvironment {
        guard
            let path = Bundle.main.path(forResource: "Environment", ofType: "plist"),
            let data = FileManager.default.contents(atPath: path),
            let object = try? PropertyListSerialization.propertyList(from: data, format: nil),
            let dict = object as? [String: Any],
            let baseURLString = dict["VOSTOK_BASE_URL"] as? String,
            let socketURLString = dict["VOSTOK_SOCKET_URL"] as? String,
            let label = dict["VOSTOK_INSTANCE_LABEL"] as? String,
            let baseURL = absoluteURL(from: baseURLString),
            let socketURL = absoluteURL(from: socketURLString)
        else {
            return AppEnvironment(
                baseURL: URL(string: "http://localhost:4000")!,
                socketURL: URL(string: "ws://localhost:4000/socket/device/websocket")!,
                instanceLabel: "Fallback"
            )
        }

        return AppEnvironment(baseURL: baseURL, socketURL: socketURL, instanceLabel: label)
    }

    private static func absoluteURL(from raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let url = URL(string: trimmed),
              let scheme = url.scheme,
              !scheme.isEmpty,
              let host = url.host,
              !host.isEmpty
        else {
            return nil
        }

        return url
    }
}
