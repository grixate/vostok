import SwiftUI

struct RegistrationView: View {
    @EnvironmentObject private var appState: AppState

    @StateObject private var viewModel: AuthViewModel
    @FocusState private var isUsernameFocused: Bool

    init(container: AppContainer) {
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
                        Image(systemName: "bubble.left.and.bubble.right.fill")
                            .font(.system(size: 32, weight: .medium))
                            .foregroundStyle(.white)
                    )
                    .padding(.top, 48)
                    .padding(.bottom, 24)

                // MARK: Title + subtitle
                Text("Create Account")
                    .font(VostokTypography.titleSection)   // 22px Semibold
                    .foregroundStyle(VostokColors.labelPrimary)
                    .padding(.bottom, 8)

                Text("Join Vostok")
                    .font(VostokTypography.subheadline)    // 15px Regular
                    .foregroundStyle(VostokColors.labelSecondary)
                    .padding(.bottom, 32)

                // MARK: Username field
                TextField("Choose a username", text: $viewModel.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel("Username")
                    .focused($isUsernameFocused)
                    .padding(.horizontal, VostokTheme.spaceXL)
                    .frame(height: 52)
                    .background(VostokColors.secondaryBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(
                                isUsernameFocused ? VostokColors.accent : Color.clear,
                                lineWidth: 2
                            )
                    )
                    .padding(.horizontal, VostokTheme.spaceXL)
                    .padding(.bottom, VostokTheme.spaceXL)

                // MARK: Submit button
                Button {
                    Task {
                        do {
                            let response = try await viewModel.register()
                            appState.applyAuthenticatedSession(
                                response.session,
                                user: response.user,
                                device: response.device
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
                        Text("Create Account")
                    }
                }
                .buttonStyle(VostokPrimaryButtonStyle())
                .accessibilityHint("Registers a new Vostok account")
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
