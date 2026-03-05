import Foundation
import Security

struct SessionRecord: Codable {
    let token: String
    let userID: String
    let username: String
    let deviceID: String
}

final class KeychainSessionStore {
    static let shared = KeychainSessionStore()

    private let service = "chat.vostok.ios.session"
    private let account = "active"

    private init() {}

    func save(token: String, userID: String, username: String, deviceID: String) {
        let record = SessionRecord(token: token, userID: userID, username: username, deviceID: deviceID)
        guard let data = try? JSONEncoder().encode(record) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        SecItemDelete(query as CFDictionary)

        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(insert as CFDictionary, nil)
    }

    func fetch() -> SessionRecord? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let record = try? JSONDecoder().decode(SessionRecord.self, from: data)
        else {
            return nil
        }

        return record
    }

    func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        SecItemDelete(query as CFDictionary)
    }
}
