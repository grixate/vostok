import SwiftUI

struct RootView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.vostokContainer) private var container
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("vostok.settings.appearance") private var appearanceSetting = "system"
    @StateObject private var networkMonitor = NetworkPathMonitor()

    var body: some View {
        if case let .failed(message) = appState.bootstrapState {
            VStack(spacing: 12) {
                Text("Unable to reach Vostok backend")
                    .font(VostokTypography.bodyEmphasized)
                Text(message)
                    .font(VostokTypography.footnote)
                    .foregroundStyle(VostokColors.labelSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                Button("Retry") {
                    Task { await appState.startup() }
                }
                .buttonStyle(VostokPrimaryButtonStyle())
                .padding(.horizontal, 24)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(VostokColors.primaryBackground)
            .preferredColorScheme(preferredColorScheme)
        } else {
            content
                .preferredColorScheme(preferredColorScheme)
                .task {
                    networkMonitor.start()
                }
                .onChange(of: scenePhase) { newValue in
                    handleScenePhaseChange(newValue)
                }
                .onChange(of: networkMonitor.isAvailable) { isAvailable in
                    Task {
                        await container.realtimeClient.updateNetworkAvailability(isAvailable)
                    }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch appState.sessionState {
        case .loading:
            ProgressView("Loading…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loggedOut:
            AuthLandingView(container: container)
        case .authenticated:
            MainTabView(container: container)
        }
    }

    private var preferredColorScheme: ColorScheme? {
        switch appearanceSetting {
        case "light":
            return .light
        case "dark":
            return .dark
        default:
            return nil
        }
    }

    private func handleScenePhaseChange(_ phase: ScenePhase) {
        guard case .authenticated = appState.sessionState else { return }
        Task {
            switch phase {
            case .active:
                await container.realtimeClient.resume()
            case .background:
                await container.realtimeClient.pause()
            case .inactive:
                break
            @unknown default:
                break
            }
        }
    }
}

private struct AuthLandingView: View {
    let container: AppContainer

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                NavigationLink("Create Account") {
                    RegistrationView(container: container)
                }
                .buttonStyle(VostokPrimaryButtonStyle())

                NavigationLink("Login") {
                    LoginView(container: container)
                }
                .buttonStyle(VostokSecondaryButtonStyle())
            }
            .padding(24)
            .navigationTitle("Vostok")
        }
    }
}

private struct MainTabView: View {
    let container: AppContainer

    var body: some View {
        TabView {
            ChatListView(container: container)
                .tabItem { Label("Chats", systemImage: "message") }

            NavigationStack { ContactListView(container: container) }
                .tabItem { Label("Members", systemImage: "person.2") }

            NavigationStack { SettingsView(container: container) }
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .vostokTabSurface()
    }
}
