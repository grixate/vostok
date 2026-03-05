import SwiftUI
import UIKit

@MainActor
final class ProfileViewModel: ObservableObject {
    @Published var user: UserDTO?
    @Published var devices: [DeviceDTO] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let apiClient: VostokAPIClientProtocol

    init(apiClient: VostokAPIClientProtocol) {
        self.apiClient = apiClient
    }

    func load(token: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let meTask = apiClient.me(token: token)
            async let devicesTask = apiClient.devices(token: token)
            let me = try await meTask
            let devices = try await devicesTask
            user = me.user
            self.devices = devices.devices
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct ProfileView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var viewModel: ProfileViewModel
    private let instanceLabel: String

    init(container: AppContainer) {
        _viewModel = StateObject(wrappedValue: ProfileViewModel(apiClient: container.apiClient))
        self.instanceLabel = container.environment.instanceLabel
    }

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    VostokAvatar(title: avatarTitle, size: 74, isOnline: true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(displayName)
                            .font(VostokTypography.title)
                            .foregroundStyle(VostokColors.labelPrimary)
                        Text("@\(usernameValue)")
                            .font(VostokTypography.body)
                            .foregroundStyle(VostokColors.labelSecondary)
                    }
                }
                .padding(.vertical, 6)
            }

            Section("Account") {
                profileRow(title: "User ID", value: viewModel.user?.id ?? "Unknown", canCopy: true)
                profileRow(title: "Username", value: "@\(usernameValue)", canCopy: true)
                profileRow(title: "Current Device", value: currentDeviceName, canCopy: false)
                profileRow(title: "Linked Devices", value: "\(viewModel.devices.count)", canCopy: false)
                profileRow(title: "Instance", value: instanceLabel, canCopy: false)
            }

            Section {
                Button("Reload") {
                    withSession { token in
                        Task { await viewModel.load(token: token) }
                    }
                }
                .buttonStyle(VostokPrimaryButtonStyle())
            }

            if let error = viewModel.errorMessage {
                Section {
                    Text(error)
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.danger)
                }
            }
        }
        .vostokNavBar(title: "Profile", large: false)
        .task {
            withSession { token in
                Task { await viewModel.load(token: token) }
            }
        }
        .overlay {
            if viewModel.isLoading {
                ProgressView()
            }
        }
    }

    private var avatarTitle: String {
        let value = usernameValue.trimmingCharacters(in: .whitespacesAndNewlines)
        return String(value.prefix(1)).uppercased()
    }

    private var displayName: String {
        "@\(usernameValue)"
    }

    private var usernameValue: String {
        if let explicit = viewModel.user?.username, !explicit.isEmpty {
            return explicit
        }
        if case let .authenticated(session) = appState.sessionState, !session.username.isEmpty {
            return session.username
        }
        return "unknown"
    }

    private var currentDeviceName: String {
        guard case let .authenticated(session) = appState.sessionState else {
            return "Unknown"
        }

        if let match = viewModel.devices.first(where: { $0.id == session.deviceID }) {
            return match.deviceName ?? match.id
        }
        return session.deviceID
    }

    private func profileRow(title: String, value: String, canCopy: Bool) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .foregroundStyle(VostokColors.labelSecondary)
            Spacer(minLength: 8)
            Text(value)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(VostokColors.labelPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
            if canCopy {
                Button {
                    UIPasteboard.general.string = value
                } label: {
                    Image(systemName: "doc.on.doc")
                        .foregroundStyle(VostokColors.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Copy \(title)")
            }
        }
    }

    private func withSession(_ action: (String) -> Void) {
        guard case let .authenticated(session) = appState.sessionState else { return }
        action(session.token)
    }
}
