import Foundation

@MainActor
final class SettingsViewModel: ObservableObject {
    // MARK: – Appearance
    @Published var appearance: Appearance {
        didSet { userDefaults.set(appearance.rawValue, forKey: Keys.appearance) }
    }
    @Published var selectedLocale: L10n.Locale {
        didSet { L10n.currentLocale = selectedLocale }
    }

    // MARK: – Notifications (matches web useSettings.ts)
    @Published var notifSound: Bool {
        didSet { userDefaults.set(notifSound, forKey: Keys.notifSound) }
    }
    @Published var notifBadge: Bool {
        didSet { userDefaults.set(notifBadge, forKey: Keys.notifBadge) }
    }
    @Published var notifPreview: Bool {
        didSet { userDefaults.set(notifPreview, forKey: Keys.notifPreview) }
    }

    // MARK: – Privacy
    @Published var privacyLastSeen: Bool {
        didSet { userDefaults.set(privacyLastSeen, forKey: Keys.privacyLastSeen) }
    }
    @Published var readReceipts: Bool {
        didSet { userDefaults.set(readReceipts, forKey: Keys.readReceipts) }
    }
    @Published var typingIndicators: Bool {
        didSet { userDefaults.set(typingIndicators, forKey: Keys.typingIndicators) }
    }
    @Published var appLockEnabled: Bool {
        didSet { userDefaults.set(appLockEnabled, forKey: Keys.appLockEnabled) }
    }

    // MARK: – Data & Storage
    @Published var keepMediaDays: Int {
        didSet { userDefaults.set(keepMediaDays, forKey: Keys.keepMediaDays) }
    }
    @Published var cacheLimitMB: Int {
        didSet { userDefaults.set(cacheLimitMB, forKey: Keys.cacheLimitMB) }
    }

    enum Appearance: String, CaseIterable, Identifiable {
        case system, light, dark
        var id: String { rawValue }
        var displayName: String {
            switch self {
            case .system: return "System"
            case .light: return "Light"
            case .dark: return "Dark"
            }
        }
    }

    private enum Keys {
        static let appearance = "vostok.settings.appearance"
        static let notifSound = "vostok.settings.notif_sound"
        static let notifBadge = "vostok.settings.notif_badge"
        static let notifPreview = "vostok.settings.notif_preview"
        static let privacyLastSeen = "vostok.settings.privacy_last_seen"
        static let readReceipts = "vostok.settings.read_receipts"
        static let typingIndicators = "vostok.settings.typing_indicators"
        static let appLockEnabled = "vostok.settings.app_lock_enabled"
        static let keepMediaDays = "vostok.settings.keep_media_days"
        static let cacheLimitMB = "vostok.settings.cache_limit_mb"
    }

    private let userDefaults: UserDefaults

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        self.appearance = Appearance(rawValue: userDefaults.string(forKey: Keys.appearance) ?? "") ?? .system
        self.selectedLocale = L10n.currentLocale
        self.notifSound = userDefaults.object(forKey: Keys.notifSound) as? Bool ?? true
        self.notifBadge = userDefaults.object(forKey: Keys.notifBadge) as? Bool ?? true
        self.notifPreview = userDefaults.object(forKey: Keys.notifPreview) as? Bool ?? true
        self.privacyLastSeen = userDefaults.object(forKey: Keys.privacyLastSeen) as? Bool ?? true
        self.readReceipts = userDefaults.object(forKey: Keys.readReceipts) as? Bool ?? true
        self.typingIndicators = userDefaults.object(forKey: Keys.typingIndicators) as? Bool ?? true
        self.appLockEnabled = userDefaults.object(forKey: Keys.appLockEnabled) as? Bool ?? false
        self.keepMediaDays = userDefaults.object(forKey: Keys.keepMediaDays) as? Int ?? 30
        self.cacheLimitMB = userDefaults.object(forKey: Keys.cacheLimitMB) as? Int ?? 1024
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
