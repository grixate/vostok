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
                Text(L10n.t("server_unreachable"))
                    .font(VostokTypography.bodyEmphasized)
                Text(message)
                    .font(VostokTypography.footnote)
                    .foregroundStyle(VostokColors.labelSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                Button(L10n.t("retry")) {
                    Task { await appState.startup() }
                }
                .buttonStyle(VostokPrimaryButtonStyle())
                .padding(.horizontal, 24)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(VostokColors.primaryBackground)
            .tint(VostokColors.accent)
            .preferredColorScheme(preferredColorScheme)
        } else {
            content
                .tint(VostokColors.accent)
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
            ProgressView(L10n.t("loading"))
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
                NavigationLink(L10n.t("create_account")) {
                    RegistrationView(container: container)
                }
                .buttonStyle(VostokPrimaryButtonStyle())

                NavigationLink(L10n.t("login")) {
                    LoginView(container: container)
                }
                .buttonStyle(VostokSecondaryButtonStyle())
            }
            .padding(24)
            .navigationTitle(L10n.t("vostok"))
        }
    }
}

private struct MainTabView: View {
    let container: AppContainer
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        if sizeClass == .regular {
            // iPad: split view with sidebar
            iPadSplitView
        } else {
            // iPhone: standard tab bar
            iPhoneTabView
        }
    }

    private var iPhoneTabView: some View {
        TabView {
            ChatListView(container: container)
                .tabItem { Label(L10n.t("chats"), systemImage: "message") }

            NavigationStack { ContactListView(container: container) }
                .tabItem { Label(L10n.t("members"), systemImage: "person.2") }

            NavigationStack { SettingsView(container: container) }
                .tabItem { Label(L10n.t("settings"), systemImage: "gearshape") }
        }
        .vostokTabSurface()
    }

    private var iPadSplitView: some View {
        NavigationSplitView {
            List {
                NavigationLink {
                    ChatListView(container: container)
                } label: {
                    Label(L10n.t("chats"), systemImage: "message")
                }

                NavigationLink {
                    ContactListView(container: container)
                } label: {
                    Label(L10n.t("members"), systemImage: "person.2")
                }

                NavigationLink {
                    SettingsView(container: container)
                } label: {
                    Label(L10n.t("settings"), systemImage: "gearshape")
                }
            }
            .navigationTitle(L10n.t("vostok"))
            .listStyle(.sidebar)
        } detail: {
            ChatListView(container: container)
        }
        .tint(VostokColors.accent)
    }
}
