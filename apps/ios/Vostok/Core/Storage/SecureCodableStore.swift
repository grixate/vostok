import CryptoKit
import Foundation
import Security

enum SecureCodableStoreError: LocalizedError {
    case missingKeyData
    case invalidSealedBox

    var errorDescription: String? {
        switch self {
        case .missingKeyData:
            return "Secure store key is missing."
        case .invalidSealedBox:
            return "Secure store payload is invalid."
        }
    }
}

final class SecureCodableStore<Value: Codable> {
    private let fileURL: URL
    private let keyService: String
    private let keyAccount: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(
        filename: String,
        keyService: String = "chat.vostok.ios.storage",
        keyAccount: String
    ) {
        self.keyService = keyService
        self.keyAccount = keyAccount

        let baseURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let directory = baseURL.appendingPathComponent("Vostok", isDirectory: true)
        if !FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        self.fileURL = directory.appendingPathComponent(filename)
    }

    func load() -> Value? {
        guard let encrypted = try? Data(contentsOf: fileURL) else { return nil }
        guard let key = loadOrCreateKey() else { return nil }
        guard let sealedBox = try? AES.GCM.SealedBox(combined: encrypted) else { return nil }
        guard let plaintext = try? AES.GCM.open(sealedBox, using: key) else { return nil }
        return try? decoder.decode(Value.self, from: plaintext)
    }

    func save(_ value: Value) {
        guard let key = loadOrCreateKey() else { return }
        guard let plaintext = try? encoder.encode(value) else { return }
        guard let sealed = try? AES.GCM.seal(plaintext, using: key) else { return }
        guard let combined = sealed.combined else { return }
        do {
            try combined.write(to: fileURL, options: .atomic)
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: fileURL.path
            )
        } catch {
            return
        }
    }

    func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }

    private func loadOrCreateKey() -> SymmetricKey? {
        if let existing = loadKeyData() {
            return SymmetricKey(data: existing)
        }

        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        guard saveKeyData(keyData) else { return nil }
        return key
    }

    private func loadKeyData() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keyService,
            kSecAttrAccount as String: keyAccount,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else { return nil }
        return item as? Data
    }

    private func saveKeyData(_ data: Data) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keyService,
            kSecAttrAccount as String: keyAccount
        ]
        SecItemDelete(query as CFDictionary)

        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(insert as CFDictionary, nil) == errSecSuccess
    }
}
