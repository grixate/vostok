import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var appState: AppState

    @StateObject private var viewModel: AuthViewModel
    @State private var deviceID = ""
    private let apiClient: VostokAPIClientProtocol

    init(container: AppContainer) {
        self.apiClient = container.apiClient
        _viewModel = StateObject(
            wrappedValue: AuthViewModel(apiClient: container.apiClient, cryptoProvider: container.cryptoProvider)
        )
    }

    var body: some View {
        Form {
            Section("Device") {
                TextField("Device ID", text: $deviceID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel("Device ID")
            }

            Section {
                Button {
                    Task {
                        do {
                            let verify = try await viewModel.login(deviceID: deviceID)
                            let me = try await apiClient.me(token: verify.session.token)
                            appState.applyAuthenticatedSession(verify.session, user: me.user, device: me.device)
                        } catch {
                            viewModel.errorMessage = error.localizedDescription
                        }
                    }
                } label: {
                    if viewModel.isLoading {
                        ProgressView()
                    } else {
                        Text("Login")
                    }
                }
                .buttonStyle(VostokPrimaryButtonStyle())
                .accessibilityHint("Signs in with this device")
            }

            if let message = viewModel.errorMessage {
                Text(message)
                    .font(VostokTypography.footnote)
                    .foregroundStyle(VostokColors.danger)
            }
        }
        .vostokNavBar(title: "Login", large: false)
    }
}
