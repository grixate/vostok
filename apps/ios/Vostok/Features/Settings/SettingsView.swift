import SwiftUI
import UIKit

struct SettingsView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var viewModel = SettingsViewModel()
    @StateObject private var pushManager = PushManager.shared
    @State private var realtimeSnapshot = RealtimeDiagnosticsSnapshot()
    private let container: AppContainer

    init(container: AppContainer) {
        self.container = container
    }

    var body: some View {
        List {
            Section("Push Notifications") {
                Button("Register APNs") {
                    pushManager.registerForPushNotifications()
                }
                .buttonStyle(VostokPrimaryButtonStyle())

                HStack {
                    Text("Permission")
                    Spacer()
                    Text(pushManager.authorizationGranted ? "Granted" : "Not granted")
                        .foregroundStyle(pushManager.authorizationGranted ? VostokColors.online : VostokColors.labelSecondary)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Token")
                    Text(pushManager.apnsToken ?? "Not registered")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(VostokColors.labelSecondary)
                        .textSelection(.enabled)
                }

                if let error = pushManager.registrationError {
                    Text(error)
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.danger)
                }
            }

            NavigationLink("Devices") { DevicesView(container: container) }
            NavigationLink("Privacy & Security") { PrivacySettingsView(viewModel: viewModel) }
            NavigationLink("Profile") { ProfileView(container: container) }
            NavigationLink("Safety Numbers") { SafetyNumberView(container: container) }
            NavigationLink("Media Lab") { MediaLabView(container: container) }

            Section("Realtime Diagnostics") {
                HStack {
                    Text("State")
                    Spacer()
                    Text(realtimeSnapshot.connectionState.rawValue.capitalized)
                        .foregroundStyle(realtimeSnapshot.connectionState == .connected ? VostokColors.online : VostokColors.labelSecondary)
                }

                HStack {
                    Text("Reconnect attempts")
                    Spacer()
                    Text("\(realtimeSnapshot.reconnectAttempt)")
                        .foregroundStyle(VostokColors.labelSecondary)
                }

                HStack {
                    Text("Network")
                    Spacer()
                    Text(realtimeSnapshot.networkAvailable ? "Available" : "Offline")
                        .foregroundStyle(realtimeSnapshot.networkAvailable ? VostokColors.online : VostokColors.danger)
                }

                HStack(alignment: .top) {
                    Text("Last disconnect")
                    Spacer()
                    Text(realtimeSnapshot.lastDisconnectReason ?? "None")
                        .multilineTextAlignment(.trailing)
                        .foregroundStyle(VostokColors.labelSecondary)
                }

                HStack(alignment: .top) {
                    Text("Joined topics")
                    Spacer()
                    Text(realtimeSnapshot.joinedTopics.isEmpty ? "None" : realtimeSnapshot.joinedTopics.joined(separator: ", "))
                        .multilineTextAlignment(.trailing)
                        .foregroundStyle(VostokColors.labelSecondary)
                }

                if let lastInboundAt = realtimeSnapshot.lastInboundAt {
                    HStack {
                        Text("Last inbound")
                        Spacer()
                        Text(RelativeDateTimeFormatter().localizedString(for: lastInboundAt, relativeTo: Date()))
                            .foregroundStyle(VostokColors.labelSecondary)
                    }
                }

                Button("Force reconnect") {
                    Task { await container.realtimeClient.forceReconnect(reason: "settings_manual") }
                }
                .buttonStyle(VostokSecondaryButtonStyle())

                Button("Copy socket log") {
                    UIPasteboard.general.string = realtimeSnapshot.recentLogLines.joined(separator: "\n")
                }
                .buttonStyle(VostokSecondaryButtonStyle())

                Button("Clear socket log") {
                    Task { await container.realtimeClient.clearDiagnosticLog() }
                }
                .buttonStyle(VostokSecondaryButtonStyle())

                if realtimeSnapshot.recentLogLines.isEmpty {
                    Text("No socket events yet")
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.labelSecondary)
                } else {
                    ForEach(realtimeSnapshot.recentLogLines.reversed(), id: \.self) { line in
                        Text(line)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(VostokColors.labelSecondary)
                            .textSelection(.enabled)
                            .accessibilityLabel(line)
                    }
                }
            }

            Button("Log out", role: .destructive) {
                appState.logout()
            }
        }
        .vostokNavBar(title: "Settings", large: true)
        .task {
            await monitorRealtimeDiagnostics()
        }
    }

    @MainActor
    private func monitorRealtimeDiagnostics() async {
        while !Task.isCancelled {
            realtimeSnapshot = await container.realtimeClient.snapshotDiagnostics()
            try? await Task.sleep(for: .seconds(1))
        }
    }
}

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
            Section("Linked Devices") {
                ForEach(viewModel.devices, id: \.id) { device in
                    HStack {
                        Text(device.deviceName ?? "Unnamed Device")
                        Spacer()
                        if case let .authenticated(session) = appState.sessionState, session.deviceID == device.id {
                            Text("Current")
                                .font(VostokTypography.caption)
                                .foregroundStyle(VostokColors.labelSecondary)
                        } else {
                            Button("Revoke", role: .destructive) {
                                if case let .authenticated(session) = appState.sessionState {
                                    Task { await viewModel.revoke(token: session.token, deviceID: device.id) }
                                }
                            }
                        }
                    }
                }
            }

            Section("Link New Device") {
                TextField("Link code", text: $viewModel.linkCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Device name", text: $viewModel.linkDeviceName)
                Button("Link Device") {
                    if case let .authenticated(session) = appState.sessionState {
                        Task { await viewModel.link(token: session.token) }
                    }
                }
                .buttonStyle(VostokPrimaryButtonStyle())
            }

            if let message = viewModel.errorMessage {
                Section {
                    Text(message)
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.danger)
                }
            }
        }
        .vostokNavBar(title: "Devices", large: false)
        .task {
            if case let .authenticated(session) = appState.sessionState {
                await viewModel.load(token: session.token)
            }
        }
    }
}

struct PrivacySettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel

    var body: some View {
        Form {
            Toggle("Read receipts", isOn: $viewModel.readReceipts)
            Toggle("Face ID lock", isOn: $viewModel.appLockEnabled)
            Picker("Appearance", selection: $viewModel.appearance) {
                ForEach(SettingsViewModel.Appearance.allCases, id: \.self) { appearance in
                    Text(appearance.rawValue.capitalized).tag(appearance)
                }
            }
        }
        .vostokNavBar(title: "Privacy", large: false)
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
                Button("Load Safety Numbers") {
                    if case let .authenticated(session) = appState.sessionState {
                        Task { await viewModel.load(token: session.token) }
                    }
                }
            }

            Section("Devices") {
                if viewModel.safetyNumbers.isEmpty {
                    Text("No safety numbers loaded")
                        .foregroundStyle(VostokColors.labelSecondary)
                }
                ForEach(viewModel.safetyNumbers, id: \.peerDeviceID) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.peerUsername)
                            .font(VostokTypography.bodyEmphasized)
                        Text(item.fingerprint)
                            .font(VostokTypography.footnote)
                            .foregroundStyle(VostokColors.labelSecondary)
                            .monospaced()
                        HStack {
                            Text(item.verified ? "Verified" : "Unverified")
                                .font(VostokTypography.caption)
                                .foregroundStyle(item.verified ? VostokColors.online : VostokColors.danger)
                            Spacer()
                            if !item.verified {
                                Button("Verify") {
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
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.danger)
                }
            }
        }
        .vostokNavBar(title: "Safety Numbers", large: false)
    }
}
