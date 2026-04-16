import SwiftUI
import UIKit

// MARK: – Main Settings View (7-section layout matching web SettingsPane.tsx)

struct SettingsView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var viewModel = SettingsViewModel()
    private let container: AppContainer

    init(container: AppContainer) {
        self.container = container
    }

    var body: some View {
        List {
            // 1. My Profile (with Active Sessions)
            Section {
                NavigationLink { ProfileView(container: container) } label: {
                    HStack(spacing: VostokTheme.spaceMD) {
                        VostokAvatar(title: currentUsername, size: 52)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(currentUsername)
                                .font(VostokTypography.title)
                            Text(L10n.t("my_profile"))
                                .font(VostokTypography.caption)
                                .foregroundStyle(VostokColors.labelSecondary)
                        }
                    }
                    .padding(.vertical, VostokTheme.spaceXS)
                }
            }

            // 2. Servers (with Backup)
            Section {
                NavigationLink { ServersView() } label: {
                    settingsRow(icon: "server.rack", title: L10n.t("servers"))
                }
            }

            // 3. Notifications and Sounds
            Section {
                NavigationLink { NotificationsSettingsView(viewModel: viewModel) } label: {
                    settingsRow(icon: "bell.badge", title: L10n.t("notifications_and_sounds"))
                }
            }

            // 4. Privacy and Security
            Section {
                NavigationLink { PrivacySettingsView(viewModel: viewModel, container: container) } label: {
                    settingsRow(icon: "lock.shield", title: L10n.t("privacy_and_security"))
                }
            }

            // 5. Data and Storage
            Section {
                NavigationLink { DataStorageSettingsView(viewModel: viewModel) } label: {
                    settingsRow(icon: "internaldrive", title: L10n.t("data_and_storage"))
                }
            }

            // 6. Appearance (with Language)
            Section {
                NavigationLink { AppearanceSettingsView(viewModel: viewModel) } label: {
                    settingsRow(icon: "paintbrush", title: L10n.t("appearance"))
                }
            }

            // 7. About & Debug
            Section {
                NavigationLink { AboutDebugView(container: container) } label: {
                    settingsRow(icon: "info.circle", title: L10n.t("about_and_debug"))
                }
            }

            // Sign Out
            Section {
                Button(L10n.t("sign_out"), role: .destructive) {
                    appState.logout()
                }
            }
        }
        .vostokNavBar(title: L10n.t("settings"), large: true)
    }

    private var currentUsername: String {
        if case let .authenticated(session) = appState.sessionState {
            return session.username
        }
        return "?"
    }

    private func settingsRow(icon: String, title: String) -> some View {
        HStack(spacing: VostokTheme.spaceMD) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(VostokColors.accent)
                .frame(width: 28, height: 28)
            Text(title)
                .font(VostokTypography.body)
        }
    }
}

// MARK: – 3. Notifications and Sounds

struct NotificationsSettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel
    @StateObject private var pushManager = PushManager.shared

    var body: some View {
        Form {
            Section {
                Toggle(L10n.t("sound"), isOn: $viewModel.notifSound)
                Toggle(L10n.t("badge_count"), isOn: $viewModel.notifBadge)
                Toggle(L10n.t("message_preview"), isOn: $viewModel.notifPreview)
            }

            Section {
                HStack {
                    Text("APNs")
                    Spacer()
                    Text(pushManager.authorizationGranted ? L10n.t("enabled") : L10n.t("disabled"))
                        .foregroundStyle(pushManager.authorizationGranted ? VostokColors.online : VostokColors.labelSecondary)
                }

                if !pushManager.authorizationGranted {
                    Button("Register APNs") {
                        pushManager.registerForPushNotifications()
                    }
                    .buttonStyle(VostokSecondaryButtonStyle())
                }

                if let error = pushManager.registrationError {
                    Text(error)
                        .font(VostokTypography.caption)
                        .foregroundStyle(VostokColors.danger)
                }
            }
        }
        .vostokNavBar(title: L10n.t("notifications_and_sounds"), large: false)
    }
}

// MARK: – 4. Privacy and Security

struct PrivacySettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel
    let container: AppContainer

    var body: some View {
        Form {
            Section {
                Toggle(L10n.t("last_seen"), isOn: $viewModel.privacyLastSeen)
                Toggle(L10n.t("read_receipts"), isOn: $viewModel.readReceipts)
                Toggle(L10n.t("typing_indicators"), isOn: $viewModel.typingIndicators)
            }

            Section {
                Toggle(L10n.t("privacy_and_security"), isOn: $viewModel.appLockEnabled)
            } footer: {
                Text("Face ID / Touch ID")
                    .font(VostokTypography.small)
            }

            Section {
                NavigationLink(L10n.t("active_sessions")) { DevicesView(container: container) }
                NavigationLink(L10n.t("safety_numbers")) { SafetyNumberView(container: container) }
            }
        }
        .vostokNavBar(title: L10n.t("privacy_and_security"), large: false)
    }
}

// MARK: – 5. Data and Storage

struct DataStorageSettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel
    @State private var autoDownload = AutoDownloadSettings.default

    private let keepMediaOptions = [7, 30, 90, 365]
    private let cacheLimitOptions = [256, 512, 1024, 2048]
    private let sizeLimitOptions = [0, 1_048_576, 5_242_880, 15_728_640, 52_428_800, 104_857_600]

    var body: some View {
        Form {
            Section(L10n.t("auto_download_private")) {
                autoDownloadRow(L10n.t("photos"), config: $autoDownload.privateChats.photos)
                autoDownloadRow(L10n.t("videos"), config: $autoDownload.privateChats.videos)
                autoDownloadRow(L10n.t("files"), config: $autoDownload.privateChats.files)
                autoDownloadRow(L10n.t("voice_messages"), config: $autoDownload.privateChats.voiceMessages)
                autoDownloadRow(L10n.t("round_videos"), config: $autoDownload.privateChats.roundVideos)
            }

            Section(L10n.t("auto_download_group")) {
                autoDownloadRow(L10n.t("photos"), config: $autoDownload.groupChats.photos)
                autoDownloadRow(L10n.t("videos"), config: $autoDownload.groupChats.videos)
                autoDownloadRow(L10n.t("files"), config: $autoDownload.groupChats.files)
                autoDownloadRow(L10n.t("voice_messages"), config: $autoDownload.groupChats.voiceMessages)
                autoDownloadRow(L10n.t("round_videos"), config: $autoDownload.groupChats.roundVideos)
            }

            Section(L10n.t("storage")) {
                Picker(L10n.t("keep_media"), selection: $viewModel.keepMediaDays) {
                    ForEach(keepMediaOptions, id: \.self) { days in
                        Text(keepMediaLabel(days)).tag(days)
                    }
                }

                Picker(L10n.t("cache_limit"), selection: $viewModel.cacheLimitMB) {
                    ForEach(cacheLimitOptions, id: \.self) { mb in
                        Text(cacheLimitLabel(mb)).tag(mb)
                    }
                }
            }

            Section {
                Button(L10n.t("clear_all_local_data"), role: .destructive) {
                    // Clear local caches — no server data affected
                }
            } footer: {
                Text(L10n.t("clear_confirm_body"))
                    .font(VostokTypography.small)
            }
        }
        .vostokNavBar(title: L10n.t("data_and_storage"), large: false)
    }

    private func autoDownloadRow(_ label: String, config: Binding<AutoDownloadMediaConfig>) -> some View {
        HStack {
            Text(label)
                .font(VostokTypography.body)
            Spacer()
            Picker("", selection: config.maxSizeBytes) {
                ForEach(sizeLimitOptions, id: \.self) { size in
                    Text(sizeLimitLabel(size)).tag(size)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
        }
    }

    private func sizeLimitLabel(_ bytes: Int) -> String {
        if bytes <= 0 { return L10n.t("off") }
        let mb = bytes / 1_048_576
        if mb >= 100 { return L10n.t("no_limit") }
        return L10n.t("up_to", "\(mb) MB")
    }

    private func keepMediaLabel(_ days: Int) -> String {
        switch days {
        case 7: return "1 week"
        case 30: return "1 month"
        case 90: return "3 months"
        case 365: return "1 year"
        default: return "\(days) days"
        }
    }

    private func cacheLimitLabel(_ mb: Int) -> String {
        if mb >= 1024 { return "\(mb / 1024) GB" }
        return "\(mb) MB"
    }
}

// MARK: – 6. Appearance (with Language)

struct AppearanceSettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel
    @AppStorage("vostok.settings.appearance") private var appearanceSetting = "system"

    var body: some View {
        Form {
            Section(L10n.t("theme")) {
                Picker(L10n.t("appearance"), selection: $viewModel.appearance) {
                    ForEach(SettingsViewModel.Appearance.allCases) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
                .onChange(of: viewModel.appearance) { newValue in
                    appearanceSetting = newValue.rawValue
                }
            }

            Section(L10n.t("language")) {
                Picker(L10n.t("language"), selection: $viewModel.selectedLocale) {
                    ForEach(L10n.Locale.allCases) { locale in
                        Text(locale.displayName).tag(locale)
                    }
                }
            }
        }
        .vostokNavBar(title: L10n.t("appearance"), large: false)
    }
}

// MARK: – 7. About & Debug

struct AboutDebugView: View {
    let container: AppContainer
    @State private var realtimeSnapshot = RealtimeDiagnosticsSnapshot()
    @State private var debugInfoCopied = false

    var body: some View {
        List {
            Section(L10n.t("vostok")) {
                labeledRow(L10n.t("client_version"), Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?")
                labeledRow(L10n.t("platform"), "iOS \(UIDevice.current.systemVersion)")
                labeledRow(L10n.t("device"), UIDevice.current.model)
                labeledRow(L10n.t("encryption"), L10n.t("e2ee_protocol"))
            }

            Section(L10n.t("status")) {
                labeledRow("State", realtimeSnapshot.connectionState.rawValue.capitalized,
                           color: realtimeSnapshot.connectionState == .connected ? VostokColors.online : VostokColors.labelSecondary)
                labeledRow("Network", realtimeSnapshot.networkAvailable ? "Available" : L10n.t("offline"),
                           color: realtimeSnapshot.networkAvailable ? VostokColors.online : VostokColors.danger)
                labeledRow("Reconnects", "\(realtimeSnapshot.reconnectAttempt)")

                if let lastInboundAt = realtimeSnapshot.lastInboundAt {
                    labeledRow("Last inbound", RelativeDateTimeFormatter().localizedString(for: lastInboundAt, relativeTo: Date()))
                }
            }

            Section {
                Button {
                    copyDebugInfo()
                } label: {
                    HStack {
                        Image(systemName: "doc.on.doc")
                        Text(debugInfoCopied ? L10n.t("copied") : L10n.t("copy_debug_info"))
                    }
                }

                Button("Force reconnect") {
                    Task { await container.realtimeClient.forceReconnect(reason: "settings_manual") }
                }
                .buttonStyle(VostokSecondaryButtonStyle())
            }

            Section("Socket Log") {
                if realtimeSnapshot.recentLogLines.isEmpty {
                    Text("No socket events yet")
                        .font(VostokTypography.caption)
                        .foregroundStyle(VostokColors.labelSecondary)
                } else {
                    ForEach(realtimeSnapshot.recentLogLines.reversed(), id: \.self) { line in
                        Text(line)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(VostokColors.labelSecondary)
                            .textSelection(.enabled)
                    }
                }

                HStack {
                    Button("Copy socket log") {
                        UIPasteboard.general.string = realtimeSnapshot.recentLogLines.joined(separator: "\n")
                    }
                    .buttonStyle(VostokSecondaryButtonStyle())

                    Button("Clear") {
                        Task { await container.realtimeClient.clearDiagnosticLog() }
                    }
                    .buttonStyle(VostokSecondaryButtonStyle())
                }
            }

            Section {
                NavigationLink(L10n.t("safety_numbers")) { SafetyNumberView(container: container) }
                NavigationLink("Media Lab") { MediaLabView(container: container) }
            }
        }
        .vostokNavBar(title: L10n.t("about_and_debug"), large: false)
        .task {
            while !Task.isCancelled {
                realtimeSnapshot = await container.realtimeClient.snapshotDiagnostics()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func labeledRow(_ label: String, _ value: String, color: Color = VostokColors.labelSecondary) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .foregroundStyle(color)
        }
    }

    private func copyDebugInfo() {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        let info = """
        Vostok iOS v\(version) (\(build))
        iOS \(UIDevice.current.systemVersion)
        Device: \(UIDevice.current.model)
        Connection: \(realtimeSnapshot.connectionState.rawValue)
        Network: \(realtimeSnapshot.networkAvailable ? "available" : "offline")
        Reconnects: \(realtimeSnapshot.reconnectAttempt)
        Topics: \(realtimeSnapshot.joinedTopics.joined(separator: ", "))
        """
        UIPasteboard.general.string = info
        debugInfoCopied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            debugInfoCopied = false
        }
    }
}

// MARK: – Existing sub-views (DevicesView, SafetyNumberView)

struct DevicesView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var viewModel: DevicesViewModel

    init(container: AppContainer) {
        _viewModel = StateObject(
            wrappedValue: DevicesViewModel(apiClient: container.apiClient, cryptoProvider: container.cryptoProvider)
        )
    }

    var body: some View {
        List {
            Section(L10n.t("active_sessions")) {
                ForEach(viewModel.devices, id: \.id) { device in
                    HStack {
                        Text(device.deviceName ?? L10n.t("unknown_device"))
                        Spacer()
                        if case let .authenticated(session) = appState.sessionState, session.deviceID == device.id {
                            Text(L10n.t("this_device"))
                                .font(VostokTypography.caption)
                                .foregroundStyle(VostokColors.labelSecondary)
                        } else {
                            Button(L10n.t("revoke"), role: .destructive) {
                                if case let .authenticated(session) = appState.sessionState {
                                    Task { await viewModel.revoke(token: session.token, deviceID: device.id) }
                                }
                            }
                        }
                    }
                }
            }

            Section(L10n.t("link_device")) {
                TextField("Link code", text: $viewModel.linkCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Device name", text: $viewModel.linkDeviceName)
                Button(L10n.t("link_device")) {
                    if case let .authenticated(session) = appState.sessionState {
                        Task { await viewModel.link(token: session.token) }
                    }
                }
                .buttonStyle(VostokPrimaryButtonStyle())
            }

            if let message = viewModel.errorMessage {
                Section {
                    Text(message)
                        .font(VostokTypography.caption)
                        .foregroundStyle(VostokColors.danger)
                }
            }
        }
        .vostokNavBar(title: L10n.t("active_sessions"), large: false)
        .task {
            if case let .authenticated(session) = appState.sessionState {
                await viewModel.load(token: session.token)
            }
        }
    }
}

struct SafetyNumberView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var viewModel: SafetyNumbersViewModel

    init(container: AppContainer) {
        _viewModel = StateObject(wrappedValue: SafetyNumbersViewModel(apiClient: container.apiClient))
    }

    var body: some View {
        List {
            Section("Chat") {
                TextField("Chat ID", text: $viewModel.chatID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button(L10n.t("safety_numbers")) {
                    if case let .authenticated(session) = appState.sessionState {
                        Task { await viewModel.load(token: session.token) }
                    }
                }
            }

            Section(L10n.t("active_sessions")) {
                if viewModel.safetyNumbers.isEmpty {
                    Text(L10n.t("no_safety_numbers"))
                        .foregroundStyle(VostokColors.labelSecondary)
                }
                ForEach(viewModel.safetyNumbers, id: \.peerDeviceID) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.peerUsername)
                            .font(VostokTypography.bodyBold)
                        Text(item.fingerprint)
                            .font(VostokTypography.caption)
                            .foregroundStyle(VostokColors.labelSecondary)
                            .monospaced()
                        HStack {
                            Text(item.verified ? L10n.t("verified") : "Unverified")
                                .font(VostokTypography.caption)
                                .foregroundStyle(item.verified ? VostokColors.online : VostokColors.danger)
                            Spacer()
                            if !item.verified {
                                Button(L10n.t("verify")) {
                                    if case let .authenticated(session) = appState.sessionState {
                                        Task { await viewModel.verify(token: session.token, peerDeviceID: item.peerDeviceID) }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if let message = viewModel.errorMessage {
                Section {
                    Text(message)
                        .font(VostokTypography.caption)
                        .foregroundStyle(VostokColors.danger)
                }
            }
        }
        .vostokNavBar(title: L10n.t("safety_numbers"), large: false)
    }
}
