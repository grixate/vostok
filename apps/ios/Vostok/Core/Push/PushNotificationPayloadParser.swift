import CryptoKit
import Foundation

enum PushNotificationConstants {
    static let messageCategoryIdentifier = "VOSTOK_MESSAGE"
    static let replyActionIdentifier = "VOSTOK_REPLY"
    static let markReadActionIdentifier = "VOSTOK_MARK_READ"
}

struct PushNotificationPayload: Equatable {
    let chatID: String?
    let messageID: String?
    let senderName: String?
    let chatTitle: String?
    let previewBody: String?
}

enum PushNotificationPayloadParser {
    static func parse(userInfo: [AnyHashable: Any]) -> PushNotificationPayload {
        let chatID = firstStringValue(
            userInfo,
            exactKeys: ["chat_id", "chatId"],
            keyPatterns: ["chatid"],
            allowGenericIDInsideChatObject: true
        )
        let messageID = firstStringValue(
            userInfo,
            exactKeys: ["message_id", "messageId"],
            keyPatterns: ["messageid"]
        )
        let senderName = firstStringValue(
            userInfo,
            exactKeys: ["sender_name", "senderName", "sender", "from"],
            keyPatterns: ["sendername", "sender", "from"]
        )
        let chatTitle = firstStringValue(
            userInfo,
            exactKeys: ["chat_title", "chatTitle", "chat_name", "chatName", "title"],
            keyPatterns: ["chattitle", "chatname", "title"]
        )
        let previewBody = decryptedPreviewText(in: userInfo) ?? fallbackPreviewBody(in: userInfo)

        return PushNotificationPayload(
            chatID: normalizeIdentifier(chatID),
            messageID: normalizeIdentifier(messageID),
            senderName: sanitizeText(senderName),
            chatTitle: sanitizeText(chatTitle),
            previewBody: sanitizeText(previewBody)
        )
    }

    private static func fallbackPreviewBody(in root: [AnyHashable: Any]) -> String? {
        let direct = firstStringValue(
            root,
            exactKeys: ["preview", "body", "message", "text", "plaintext_preview", "plaintext_body"],
            keyPatterns: ["preview", "body", "message", "text", "plaintextpreview", "plaintextbody"]
        )
        if let direct {
            return direct
        }

        if let aps = nestedDictionary(root, keyPatterns: ["aps"]) {
            if let alertString = firstStringValue(aps, exactKeys: ["alert"], keyPatterns: ["alert"]) {
                return alertString
            }
            if let alertObject = nestedDictionary(aps, keyPatterns: ["alert"]) {
                return firstStringValue(alertObject, exactKeys: ["body"], keyPatterns: ["body"])
            }
        }

        return nil
    }

    private static func decryptedPreviewText(in root: [AnyHashable: Any]) -> String? {
        if let plainBase64 = firstStringValue(
            root,
            exactKeys: ["preview_b64", "preview_base64", "body_b64", "body_base64"],
            keyPatterns: ["previewb64", "previewbase64", "bodyb64", "bodybase64"]
        ),
           let plain = decodeBase64UTF8(plainBase64) {
            return plain
        }

        if let combinedCiphertext = firstStringValue(
            root,
            exactKeys: ["encrypted_preview_b64", "encrypted_body_b64", "ciphertext_b64"],
            keyPatterns: ["encryptedpreviewb64", "encryptedbodyb64", "ciphertextb64"]
        ),
           let keyBase64 = firstStringValue(
            root,
            exactKeys: ["preview_key_b64", "message_key_b64", "key_b64"],
            keyPatterns: ["previewkeyb64", "messagekeyb64", "keyb64"]
           ),
           let decrypted = decryptAESGCMCombined(ciphertextCombinedBase64: combinedCiphertext, keyBase64: keyBase64) {
            return decrypted
        }

        if let ciphertext = firstStringValue(root, exactKeys: ["ciphertext_b64"], keyPatterns: ["ciphertextb64"]),
           let keyBase64 = firstStringValue(root, exactKeys: ["key_b64"], keyPatterns: ["keyb64"]),
           let nonceBase64 = firstStringValue(root, exactKeys: ["nonce_b64"], keyPatterns: ["nonceb64"]),
           let tagBase64 = firstStringValue(root, exactKeys: ["tag_b64"], keyPatterns: ["tagb64"]),
           let decrypted = decryptAESGCMDetached(
            ciphertextBase64: ciphertext,
            keyBase64: keyBase64,
            nonceBase64: nonceBase64,
            tagBase64: tagBase64
           ) {
            return decrypted
        }

        return nil
    }

    private static func decryptAESGCMCombined(ciphertextCombinedBase64: String, keyBase64: String) -> String? {
        guard let keyData = Data(base64Encoded: keyBase64),
              let combined = Data(base64Encoded: ciphertextCombinedBase64)
        else {
            return nil
        }

        do {
            let key = SymmetricKey(data: keyData)
            let sealed = try AES.GCM.SealedBox(combined: combined)
            let plaintext = try AES.GCM.open(sealed, using: key)
            return String(data: plaintext, encoding: .utf8)
        } catch {
            return nil
        }
    }

    private static func decryptAESGCMDetached(
        ciphertextBase64: String,
        keyBase64: String,
        nonceBase64: String,
        tagBase64: String
    ) -> String? {
        guard let keyData = Data(base64Encoded: keyBase64),
              let ciphertext = Data(base64Encoded: ciphertextBase64),
              let nonceData = Data(base64Encoded: nonceBase64),
              let tagData = Data(base64Encoded: tagBase64)
        else {
            return nil
        }

        do {
            let key = SymmetricKey(data: keyData)
            let nonce = try AES.GCM.Nonce(data: nonceData)
            let sealed = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tagData)
            let plaintext = try AES.GCM.open(sealed, using: key)
            return String(data: plaintext, encoding: .utf8)
        } catch {
            return nil
        }
    }

    private static func decodeBase64UTF8(_ value: String) -> String? {
        guard let data = Data(base64Encoded: value) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func nestedDictionary(_ root: [AnyHashable: Any], keyPatterns: [String]) -> [AnyHashable: Any]? {
        for (key, value) in root {
            guard keyPatterns.contains(normalizedKey(String(describing: key))) else { continue }
            return value as? [AnyHashable: Any]
        }
        return nil
    }

    private static func firstStringValue(
        _ root: [AnyHashable: Any],
        exactKeys: [String],
        keyPatterns: [String],
        allowGenericIDInsideChatObject: Bool = false
    ) -> String? {
        if let direct = lookupString(in: root, exactKeys: exactKeys, keyPatterns: keyPatterns) {
            return direct
        }

        if allowGenericIDInsideChatObject,
           let chatObject = nestedChatObject(in: root),
           let chatID = lookupString(in: chatObject, exactKeys: ["id"], keyPatterns: ["id"]) {
            return chatID
        }

        for value in root.values {
            if let nested = value as? [AnyHashable: Any],
               let candidate = firstStringValue(
                nested,
                exactKeys: exactKeys,
                keyPatterns: keyPatterns,
                allowGenericIDInsideChatObject: allowGenericIDInsideChatObject
               ) {
                return candidate
            }
            if let nestedArray = value as? [Any] {
                for item in nestedArray {
                    if let nested = item as? [AnyHashable: Any],
                       let candidate = firstStringValue(
                        nested,
                        exactKeys: exactKeys,
                        keyPatterns: keyPatterns,
                        allowGenericIDInsideChatObject: allowGenericIDInsideChatObject
                       ) {
                        return candidate
                    }
                }
            }
        }

        return nil
    }

    private static func nestedChatObject(in root: [AnyHashable: Any]) -> [AnyHashable: Any]? {
        for (key, value) in root {
            let normalized = normalizedKey(String(describing: key))
            guard normalized == "chat" || normalized == "conversation" || normalized == "room" else { continue }
            if let object = value as? [AnyHashable: Any] {
                return object
            }
        }
        return nil
    }

    private static func lookupString(
        in root: [AnyHashable: Any],
        exactKeys: [String],
        keyPatterns: [String]
    ) -> String? {
        let normalizedExact = Set(exactKeys.map(normalizedKey))
        let normalizedPatterns = Set(keyPatterns.map(normalizedKey))

        for (key, value) in root {
            let normalized = normalizedKey(String(describing: key))
            guard normalizedExact.contains(normalized) || normalizedPatterns.contains(normalized) else { continue }
            if let string = value as? String {
                return string
            }
            if let number = value as? NSNumber {
                return number.stringValue
            }
        }

        return nil
    }

    private static func normalizedKey(_ raw: String) -> String {
        raw.lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "-", with: "")
    }

    private static func normalizeIdentifier(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return trimmed.removingPercentEncoding ?? trimmed
    }

    private static func sanitizeText(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
