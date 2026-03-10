import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var appState: AppState

    @StateObject private var viewModel: AuthViewModel
    @State private var deviceID = ""
    @FocusState private var isDeviceIDFocused: Bool

    private let apiClient: VostokAPIClientProtocol

    init(container: AppContainer) {
        self.apiClient = container.apiClient
        _viewModel = StateObject(
            wrappedValue: AuthViewModel(apiClient: container.apiClient, cryptoProvider: container.cryptoProvider)
        )
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {

                // MARK: Brand mark
                Circle()
                    .fill(VostokColors.accent)
                    .frame(width: 80, height: 80)
                    .overlay(
                        Image(systemName: "person.fill.checkmark")
                            .font(.system(size: 32, weight: .medium))
                            .foregroundStyle(.white)
                    )
                    .padding(.top, 48)
                    .padding(.bottom, 24)

                // MARK: Title + subtitle
                Text("Sign In")
                    .font(VostokTypography.titleSection)   // 22px Semibold
                    .foregroundStyle(VostokColors.labelPrimary)
                    .padding(.bottom, 8)

                Text("Use your device ID to continue")
                    .font(VostokTypography.subheadline)    // 15px Regular
                    .foregroundStyle(VostokColors.labelSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, VostokTheme.spaceXL)
                    .padding(.bottom, 32)

                // MARK: Device ID field
                TextField("Device ID", text: $deviceID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel("Device ID")
                    .focused($isDeviceIDFocused)
                    .padding(.horizontal, VostokTheme.spaceXL)
                    .frame(height: 52)
                    .background(VostokColors.secondaryBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(
                                isDeviceIDFocused ? VostokColors.accent : Color.clear,
                                lineWidth: 2
                            )
                    )
                    .padding(.horizontal, VostokTheme.spaceXL)
                    .padding(.bottom, VostokTheme.spaceXL)

                // MARK: Submit button
                Button {
                    Task {
                        do {
                            let verify = try await viewModel.login(deviceID: deviceID)
                            let me = try await apiClient.me(token: verify.session.token)
                            appState.applyAuthenticatedSession(
                                verify.session,
                                user: me.user,
                                device: me.device
                            )
                        } catch {
                            viewModel.errorMessage = error.localizedDescription
                        }
                    }
                } label: {
                    if viewModel.isLoading {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Text("Sign In")
                    }
                }
                .buttonStyle(VostokPrimaryButtonStyle())
                .accessibilityHint("Signs in with this device")
                .padding(.horizontal, VostokTheme.spaceXL)

                // MARK: Error message
                if let message = viewModel.errorMessage {
                    Text(message)
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.danger)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, VostokTheme.spaceXL)
                        .padding(.top, VostokTheme.spaceMD)
                }

                Spacer(minLength: VostokTheme.space3XL)
            }
            .frame(maxWidth: .infinity)
        }
        .background(VostokColors.primaryBackground.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }
}
