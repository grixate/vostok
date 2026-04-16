import Foundation
import CryptoKit
import CommonCrypto

// ---------------------------------------------------------------------------
// .vostok backup file — encryption / decryption / format
// ---------------------------------------------------------------------------
//
// File layout (matches apps/web/src/lib/backup-crypto.ts):
//   Bytes 0-7:      Magic "VOSTOK01" (ASCII)
//   Bytes 8-11:     Version uint32 BE (1)
//   Bytes 12-15:    Salt length uint32 BE (N)
//   Bytes 16..16+N: Salt (random, for PBKDF2)
//   Rest:           12-byte AES-GCM nonce ‖ ciphertext
//
// Encryption: PBKDF2-SHA256 (600,000 iterations) → AES-256-GCM

// MARK: – Types

enum BackupCredentialMode: String, Codable, CaseIterable, Identifiable {
    case addressesOnly = "addresses_only"
    case quickRestore = "quick_restore"
    case fullCredentials = "full_credentials"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .addressesOnly: return L10n.t("addresses_only")
        case .quickRestore: return L10n.t("quick_restore")
        case .fullCredentials: return L10n.t("full_credentials")
        }
    }
}

struct BackupServerEntry: Codable {
    let url: String
    let username: String
    let label: String
    let color: String
    let sortOrder: Int
    let credentials: BackupCredentials

    enum CodingKeys: String, CodingKey {
        case url, username, label, color
        case sortOrder = "sort_order"
        case credentials
    }
}

struct BackupCredentials: Codable {
    let refreshToken: String?
    let refreshTokenExpiresAt: String?
    let password: String?

    enum CodingKeys: String, CodingKey {
        case refreshToken = "refresh_token"
        case refreshTokenExpiresAt = "refresh_token_expires_at"
        case password
    }
}

struct BackupPayload: Codable {
    let version: Int
    let createdAt: String
    let expiresAt: String
    let credentialMode: BackupCredentialMode
    let servers: [BackupServerEntry]

    enum CodingKeys: String, CodingKey {
        case version
        case createdAt = "created_at"
        case expiresAt = "expires_at"
        case credentialMode = "credential_mode"
        case servers
    }
}

// MARK: – Constants

private let magic = "VOSTOK01"
private let formatVersion: UInt32 = 1
private let saltBytes = 32
private let pbkdf2Iterations: UInt32 = 600_000
private let ivBytes = 12

// MARK: – Errors

enum BackupError: LocalizedError {
    case fileTooSmall
    case invalidMagic
    case unsupportedVersion(UInt32)
    case truncatedSalt
    case truncatedBody
    case wrongPassphrase
    case invalidPayload
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .fileTooSmall: return "File too small to be a valid backup"
        case .invalidMagic: return L10n.t("invalid_backup_file")
        case .unsupportedVersion(let v): return "Unsupported backup version: \(v)"
        case .truncatedSalt: return "File truncated — salt missing"
        case .truncatedBody: return "File truncated — encrypted data missing"
        case .wrongPassphrase: return L10n.t("failed_decrypt_backup")
        case .invalidPayload: return "Invalid backup payload"
        case .encodingFailed: return "Failed to encode backup"
        }
    }
}

// MARK: – Public API

/// Returns true if the first 8 bytes are the VOSTOK01 magic.
func validateBackupMagic(_ file: Data) -> Bool {
    guard file.count >= 8 else { return false }
    return String(data: file[0..<8], encoding: .ascii) == magic
}

/// Encrypt a backup payload and produce the .vostok file bytes.
func exportBackupFile(payload: BackupPayload, passphrase: String) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let plaintext = try? encoder.encode(payload) else {
        throw BackupError.encodingFailed
    }

    // Generate salt
    var salt = Data(count: saltBytes)
    salt.withUnsafeMutableBytes { ptr in
        _ = SecRandomCopyBytes(kSecRandomDefault, saltBytes, ptr.baseAddress!)
    }

    // Derive key
    let key = try deriveBackupKey(passphrase: passphrase, salt: salt)

    // Encrypt with AES-GCM
    let nonce = try AES.GCM.Nonce(data: randomBytes(ivBytes))
    let sealed = try AES.GCM.seal(plaintext, using: key, nonce: nonce)

    // Build file: header + nonce + ciphertext+tag
    var file = Data()
    file.append(serializeHeader(salt: salt))
    file.append(sealed.nonce.withUnsafeBytes { Data($0) })
    file.append(sealed.ciphertext)
    file.append(sealed.tag)

    return file
}

/// Decrypt a .vostok file and return the parsed payload.
/// Throws on wrong passphrase (GCM tag mismatch) or corrupt file.
func importBackupFile(fileBytes: Data, passphrase: String) throws -> BackupPayload {
    let (salt, body) = try parseHeader(file: fileBytes)

    let key = try deriveBackupKey(passphrase: passphrase, salt: salt)

    // Split body: nonce (12 bytes) + ciphertext (variable) + tag (16 bytes)
    let tagBytes = 16
    guard body.count >= ivBytes + tagBytes else {
        throw BackupError.truncatedBody
    }

    let nonceData = body[body.startIndex..<body.startIndex.advanced(by: ivBytes)]
    let nonce = try AES.GCM.Nonce(data: nonceData)
    let ciphertextStart = body.startIndex.advanced(by: ivBytes)
    let tagStart = body.endIndex.advanced(by: -tagBytes)
    let ciphertext = body[ciphertextStart..<tagStart]
    let tag = body[tagStart..<body.endIndex]

    do {
        let sealedBox = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        let plaintext = try AES.GCM.open(sealedBox, using: key)

        let decoder = JSONDecoder()
        let payload = try decoder.decode(BackupPayload.self, from: plaintext)
        guard payload.version == 1 else {
            throw BackupError.unsupportedVersion(UInt32(payload.version))
        }
        return payload
    } catch is CryptoKitError {
        throw BackupError.wrongPassphrase
    } catch let error as BackupError {
        throw error
    } catch {
        throw BackupError.wrongPassphrase
    }
}

// MARK: – Payload construction

/// Creates a BackupPayload from the current server list.
func buildBackupPayload(
    servers: [ServerEntry],
    credentialMode: BackupCredentialMode,
    expiresInDays: Int = 90
) -> BackupPayload {
    let now = Date()
    let expiry = Calendar.current.date(byAdding: .day, value: expiresInDays, to: now) ?? now

    let formatter = ISO8601DateFormatter()

    let backupServers = servers.filter { $0.enabled }.map { server -> BackupServerEntry in
        let credentials: BackupCredentials
        switch credentialMode {
        case .addressesOnly:
            credentials = BackupCredentials(refreshToken: nil, refreshTokenExpiresAt: nil, password: nil)
        case .quickRestore:
            credentials = BackupCredentials(
                refreshToken: server.auth?.token,
                refreshTokenExpiresAt: nil,
                password: nil
            )
        case .fullCredentials:
            credentials = BackupCredentials(
                refreshToken: server.auth?.token,
                refreshTokenExpiresAt: nil,
                password: nil
            )
        }

        return BackupServerEntry(
            url: server.url,
            username: server.auth?.username ?? "",
            label: server.label,
            color: server.color,
            sortOrder: server.sortOrder,
            credentials: credentials
        )
    }

    return BackupPayload(
        version: 1,
        createdAt: formatter.string(from: now),
        expiresAt: formatter.string(from: expiry),
        credentialMode: credentialMode,
        servers: backupServers
    )
}

// MARK: – Private helpers

private func deriveBackupKey(passphrase: String, salt: Data) throws -> SymmetricKey {
    let passphraseData = Data(passphrase.utf8)
    var derivedKey = Data(count: 32)

    let status = derivedKey.withUnsafeMutableBytes { derivedPtr in
        passphraseData.withUnsafeBytes { passPtr in
            salt.withUnsafeBytes { saltPtr in
                CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2),
                    passPtr.baseAddress?.assumingMemoryBound(to: Int8.self),
                    passphraseData.count,
                    saltPtr.baseAddress?.assumingMemoryBound(to: UInt8.self),
                    salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                    pbkdf2Iterations,
                    derivedPtr.baseAddress?.assumingMemoryBound(to: UInt8.self),
                    32
                )
            }
        }
    }

    guard status == kCCSuccess else {
        throw BackupError.encodingFailed
    }

    return SymmetricKey(data: derivedKey)
}

private func serializeHeader(salt: Data) -> Data {
    var header = Data()
    header.append(Data(magic.utf8))                          // 8 bytes
    header.append(formatVersion.bigEndianData)               // 4 bytes
    header.append(UInt32(salt.count).bigEndianData)           // 4 bytes
    header.append(salt)                                       // N bytes
    return header
}

private func parseHeader(file: Data) throws -> (salt: Data, body: Data) {
    guard file.count >= 16 else {
        throw BackupError.fileTooSmall
    }

    let fileMagic = String(data: file[0..<8], encoding: .ascii)
    guard fileMagic == magic else {
        throw BackupError.invalidMagic
    }

    let version = file[8..<12].withUnsafeBytes { $0.load(as: UInt32.self).bigEndian }
    guard version == formatVersion else {
        throw BackupError.unsupportedVersion(version)
    }

    let saltLength = Int(file[12..<16].withUnsafeBytes { $0.load(as: UInt32.self).bigEndian })
    guard saltLength <= 1024 else {
        throw BackupError.truncatedSalt // Unreasonable salt length
    }
    guard file.count >= 16 + saltLength else {
        throw BackupError.truncatedSalt
    }

    let salt = file[16..<(16 + saltLength)]
    let body = file[(16 + saltLength)...]

    guard body.count >= ivBytes + 16 else {
        throw BackupError.truncatedBody // Need at least nonce (12) + tag (16)
    }

    return (Data(salt), Data(body))
}

private func randomBytes(_ count: Int) -> Data {
    var data = Data(count: count)
    data.withUnsafeMutableBytes { ptr in
        _ = SecRandomCopyBytes(kSecRandomDefault, count, ptr.baseAddress!)
    }
    return data
}

private extension UInt32 {
    var bigEndianData: Data {
        var value = self.bigEndian
        return Data(bytes: &value, count: 4)
    }
}
