import Foundation

enum AppRoute: Equatable {
    case chat(chatID: String)
    case user(username: String)
}

enum AppRouteParser {
    static func route(from url: URL) -> AppRoute? {
        if let chatID = chatID(from: url) {
            return .chat(chatID: chatID)
        }
        if let username = username(from: url) {
            return .user(username: username)
        }
        return nil
    }

    static func route(fromNotificationUserInfo userInfo: [AnyHashable: Any]) -> AppRoute? {
        if let chatID = PushNotificationPayloadParser.parse(userInfo: userInfo).chatID {
            return .chat(chatID: chatID)
        }
        if let chatID = chatID(from: userInfo) {
            return .chat(chatID: chatID)
        }
        return nil
    }

    private static func chatID(from url: URL) -> String? {
        if let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            if let queryValue = components.queryItems?
                .first(where: { normalizedKey($0.name) == "chatid" })?
                .value,
               let normalized = normalizeID(queryValue) {
                return normalized
            }
        }

        let scheme = (url.scheme ?? "").lowercased()
        let host = (url.host ?? "").lowercased()
        let pathComponents = url.pathComponents.filter { $0 != "/" }.map { $0.lowercased() }

        if scheme == "vostok" {
            if host == "chat" || host == "chats" {
                if let candidate = url.pathComponents.filter({ $0 != "/" }).first,
                   let normalized = normalizeID(candidate) {
                    return normalized
                }
            }

            if let chatIndex = pathComponents.firstIndex(where: { $0 == "chat" || $0 == "chats" }),
               pathComponents.indices.contains(chatIndex + 1) {
                let original = url.pathComponents.filter { $0 != "/" }[chatIndex + 1]
                if let normalized = normalizeID(original) {
                    return normalized
                }
            }
        }

        if scheme == "http" || scheme == "https" {
            if let chatIndex = pathComponents.firstIndex(where: { $0 == "chat" || $0 == "chats" }),
               pathComponents.indices.contains(chatIndex + 1) {
                let original = url.pathComponents.filter { $0 != "/" }[chatIndex + 1]
                if let normalized = normalizeID(original) {
                    return normalized
                }
            }
        }

        return nil
    }

    private static func username(from url: URL) -> String? {
        if let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            if let queryValue = components.queryItems?
                .first(where: { normalizedKey($0.name) == "username" || normalizedKey($0.name) == "user" })?
                .value,
               let normalized = normalizeUsername(queryValue) {
                return normalized
            }
        }

        let scheme = (url.scheme ?? "").lowercased()
        let host = (url.host ?? "").lowercased()
        let originalPathComponents = url.pathComponents.filter { $0 != "/" }
        let pathComponents = originalPathComponents.map { $0.lowercased() }

        if scheme == "vostok" {
            if (host == "user" || host == "users" || host == "u"),
               let candidate = originalPathComponents.first,
               let normalized = normalizeUsername(candidate) {
                return normalized
            }

            if let userIndex = pathComponents.firstIndex(where: { $0 == "user" || $0 == "users" || $0 == "u" }),
               pathComponents.indices.contains(userIndex + 1) {
                let original = originalPathComponents[userIndex + 1]
                if let normalized = normalizeUsername(original) {
                    return normalized
                }
            }

            if let first = originalPathComponents.first,
               let normalized = normalizeUsername(first) {
                return normalized
            }
        }

        if scheme == "http" || scheme == "https" {
            if let first = originalPathComponents.first,
               let normalized = normalizeUsername(first) {
                return normalized
            }

            if let userIndex = pathComponents.firstIndex(where: { $0 == "user" || $0 == "users" || $0 == "u" }),
               pathComponents.indices.contains(userIndex + 1) {
                let original = originalPathComponents[userIndex + 1]
                if let normalized = normalizeUsername(original) {
                    return normalized
                }
            }
        }

        return nil
    }

    private static func chatID(from userInfo: [AnyHashable: Any]) -> String? {
        if let direct = valueForKnownChatIDKeys(in: userInfo), let normalized = normalizeID(direct) {
            return normalized
        }

        if let nested = nestedChatID(in: userInfo), let normalized = normalizeID(nested) {
            return normalized
        }

        return nil
    }

    private static func nestedChatID(in value: Any) -> String? {
        if let dictionary = value as? [AnyHashable: Any] {
            if let direct = valueForKnownChatIDKeys(in: dictionary) {
                return direct
            }

            if let chatObject = valueForKnownChatObjectKeys(in: dictionary) as? [AnyHashable: Any],
               let directInChat = valueForKnownChatIDKeys(in: chatObject, allowGenericIDKey: true) {
                return directInChat
            }

            for nestedValue in dictionary.values {
                if let found = nestedChatID(in: nestedValue) {
                    return found
                }
            }
        } else if let array = value as? [Any] {
            for nestedValue in array {
                if let found = nestedChatID(in: nestedValue) {
                    return found
                }
            }
        }

        return nil
    }

    private static func valueForKnownChatIDKeys(
        in dictionary: [AnyHashable: Any],
        allowGenericIDKey: Bool = false
    ) -> String? {
        for (key, value) in dictionary {
            let normalized = normalizedKey(String(describing: key))
            guard normalized == "chatid" || (allowGenericIDKey && normalized == "id") else { continue }
            if let string = value as? String {
                return string
            }
            if let number = value as? NSNumber {
                return number.stringValue
            }
        }
        return nil
    }

    private static func valueForKnownChatObjectKeys(in dictionary: [AnyHashable: Any]) -> Any? {
        for (key, value) in dictionary {
            let normalized = normalizedKey(String(describing: key))
            if normalized == "chat" || normalized == "conversation" || normalized == "room" {
                return value
            }
        }
        return nil
    }

    private static func normalizedKey(_ input: String) -> String {
        input
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "-", with: "")
    }

    private static func normalizeID(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return nil
        }
        return trimmed.removingPercentEncoding ?? trimmed
    }

    private static func normalizeUsername(_ value: String) -> String? {
        let decoded = value.removingPercentEncoding ?? value
        let trimmed = decoded.trimmingCharacters(in: .whitespacesAndNewlines)
        let withoutAt = trimmed.hasPrefix("@") ? String(trimmed.dropFirst()) : trimmed
        if withoutAt.isEmpty {
            return nil
        }
        return withoutAt
    }
}
