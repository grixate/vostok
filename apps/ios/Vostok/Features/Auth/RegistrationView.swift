import SwiftUI

struct RegistrationView: View {
    @EnvironmentObject private var appState: AppState

    @StateObject private var viewModel: AuthViewModel

    init(container: AppContainer) {
        _viewModel = StateObject(
            wrappedValue: AuthViewModel(apiClient: container.apiClient, cryptoProvider: container.cryptoProvider)
        )
    }

    var body: some View {
        Form {
            Section("Account") {
                TextField("Choose a username", text: $viewModel.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel("Username")
            }

            Section {
                Button {
                    Task {
                        do {
                            let response = try await viewModel.register()
                            appState.applyAuthenticatedSession(response.session, user: response.user, device: response.device)
                        } catch {
                            viewModel.errorMessage = error.localizedDescription
                        }
                    }
                } label: {
                    if viewModel.isLoading {
                        ProgressView()
                    } else {
                        Text("Create Account")
                    }
                }
                .buttonStyle(VostokPrimaryButtonStyle())
                .accessibilityHint("Registers a new Vostok account")
            }

            if let message = viewModel.errorMessage {
                Text(message)
                    .font(VostokTypography.footnote)
                    .foregroundStyle(VostokColors.danger)
            }
        }
        .vostokNavBar(title: "Create Account", large: true)
    }
}
