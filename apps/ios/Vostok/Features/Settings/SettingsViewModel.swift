import Foundation

@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var appearance: Appearance {
        didSet { userDefaults.set(appearance.rawValue, forKey: Keys.appearance) }
    }
    @Published var readReceipts: Bool {
        didSet { userDefaults.set(readReceipts, forKey: Keys.readReceipts) }
    }
    @Published var appLockEnabled: Bool {
        didSet { userDefaults.set(appLockEnabled, forKey: Keys.appLockEnabled) }
    }

    enum Appearance: String, CaseIterable {
        case system, light, dark
    }

    private enum Keys {
        static let appearance = "vostok.settings.appearance"
        static let readReceipts = "vostok.settings.read_receipts"
        static let appLockEnabled = "vostok.settings.app_lock_enabled"
    }

    private let userDefaults: UserDefaults

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        let storedAppearance = Appearance(rawValue: userDefaults.string(forKey: Keys.appearance) ?? "") ?? .system
        self.appearance = storedAppearance
        self.readReceipts = userDefaults.object(forKey: Keys.readReceipts) as? Bool ?? true
        self.appLockEnabled = userDefaults.object(forKey: Keys.appLockEnabled) as? Bool ?? false
    }
}

@MainActor
final class DevicesViewModel: ObservableObject {
    @Published var devices: [DeviceDTO] = []
    @Published var linkCode = ""
    @Published var linkDeviceName = "iPhone"
    @Published var errorMessage: String?
    @Published var isLoading = false

    private let apiClient: VostokAPIClientProtocol
    private let cryptoProvider: CryptoProviderProtocol

    init(apiClient: VostokAPIClientProtocol, cryptoProvider: CryptoProviderProtocol) {
        self.apiClient = apiClient
        self.cryptoProvider = cryptoProvider
    }

    func load(token: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            devices = try await apiClient.devices(token: token).devices
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func revoke(token: String, deviceID: String) async {
        do {
            devices = try await apiClient.revokeDevice(token: token, deviceID: deviceID).devices
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func link(token: String) async {
        let code = linkCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else { return }

        do {
            let identity = try cryptoProvider.generateIdentity()
            let request = LinkDeviceRequest(
                code: code,
                deviceName: linkDeviceName,
                deviceIdentityPublicKey: identity.deviceIdentityPublicKey,
                deviceEncryptionPublicKey: identity.deviceEncryptionPublicKey,
                signedPrekey: identity.signedPrekey,
                signedPrekeySignature: identity.signedPrekeySignature,
                oneTimePrekeys: identity.oneTimePrekeys
            )

            _ = try await apiClient.linkDevice(token: token, request: request)
            linkCode = ""
            await load(token: token)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

@MainActor
final class SafetyNumbersViewModel: ObservableObject {
    @Published var chatID = ""
    @Published var safetyNumbers: [SafetyNumberDTO] = []
    @Published var errorMessage: String?
    @Published var isLoading = false

    private let apiClient: VostokAPIClientProtocol

    init(apiClient: VostokAPIClientProtocol) {
        self.apiClient = apiClient
    }

    func load(token: String) async {
        let trimmed = chatID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            safetyNumbers = try await apiClient.safetyNumbers(token: token, chatID: trimmed).safetyNumbers
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func verify(token: String, peerDeviceID: String) async {
        let trimmed = chatID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            let verified = try await apiClient.verifySafetyNumber(token: token, chatID: trimmed, peerDeviceID: peerDeviceID)
            if let index = safetyNumbers.firstIndex(where: { $0.peerDeviceID == peerDeviceID }) {
                safetyNumbers[index] = verified
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
