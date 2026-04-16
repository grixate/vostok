import SwiftUI

struct ServersView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.vostokContainer) private var container
    @State private var servers: [ServerEntry] = []
    @State private var showingAddServer = false
    @State private var showingExportBackup = false
    @State private var showingImportBackup = false

    var body: some View {
        List {
            Section {
                ForEach(servers) { server in
                    serverRow(server)
                }
                .onDelete { indexSet in
                    for index in indexSet {
                        let server = servers[index]
                        container.removeServer(id: server.id)
                    }
                    servers = container.serverStore.load()
                }
            }

            Section {
                Button {
                    showingAddServer = true
                } label: {
                    Label(L10n.t("add_server"), systemImage: "plus.circle")
                }
            }

            Section(L10n.t("backup")) {
                Button {
                    showingExportBackup = true
                } label: {
                    Label(L10n.t("export_backup"), systemImage: "square.and.arrow.up")
                }
                Button {
                    showingImportBackup = true
                } label: {
                    Label(L10n.t("import_backup"), systemImage: "square.and.arrow.down")
                }
            }
        }
        .vostokNavBar(title: L10n.t("servers"), large: true)
        .onAppear {
            servers = container.serverStore.load()
        }
        .sheet(isPresented: $showingExportBackup) {
            BackupExportView()
        }
        .sheet(isPresented: $showingImportBackup) {
            BackupImportView()
        }
        .sheet(isPresented: $showingAddServer) {
            AddServerView { newServer in
                let entry = ServerEntry.create(url: newServer.url, label: newServer.label, color: newServer.color)
                _ = container.serverStore.add(entry)
                container.createContext(for: entry)
                servers = container.serverStore.load()
            }
        }
    }

    private func serverRow(_ server: ServerEntry) -> some View {
        HStack(spacing: VostokTheme.spaceMD) {
            Circle()
                .fill(Color(hex: server.color))
                .frame(width: 12, height: 12)

            VStack(alignment: .leading, spacing: 2) {
                Text(server.label)
                    .font(VostokTypography.title)
                Text(server.url)
                    .font(VostokTypography.caption)
                    .foregroundStyle(VostokColors.labelSecondary)
                    .lineLimit(1)
            }

            Spacer()

            statusBadge(for: server)
        }
        .padding(.vertical, VostokTheme.spaceXS)
    }

    @ViewBuilder
    private func statusBadge(for server: ServerEntry) -> some View {
        let status = appState.serverConnectionStates[server.id] ?? .disconnected
        HStack(spacing: 4) {
            Circle()
                .fill(statusColor(status))
                .frame(width: 8, height: 8)
            Text(statusLabel(status))
                .font(VostokTypography.small)
                .foregroundStyle(VostokColors.labelSecondary)
        }
    }

    private func statusColor(_ status: ServerConnectionStatus) -> Color {
        switch status {
        case .connected: return VostokColors.online
        case .connecting: return VostokColors.accentAmber
        case .authRequired: return VostokColors.danger
        case .error: return VostokColors.danger
        case .offline: return VostokColors.labelTertiary
        case .disconnected: return VostokColors.labelTertiary
        }
    }

    private func statusLabel(_ status: ServerConnectionStatus) -> String {
        switch status {
        case .connected: return L10n.t("connected")
        case .connecting: return L10n.t("connecting")
        case .authRequired: return L10n.t("sign_in_required")
        case .error: return L10n.t("connection_error")
        case .offline: return L10n.t("offline")
        case .disconnected: return L10n.t("disconnected")
        }
    }
}

// MARK: – Add Server

struct AddServerView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var label = ""
    @State private var selectedColor = "#FF5500"
    var onAdd: (NewServer) -> Void

    struct NewServer {
        let url: String
        let label: String
        let color: String
    }

    private let colorOptions = [
        "#FF5500", "#FF5C5C", "#4FAE4E", "#E6A817",
        "#009EE6", "#7B68EE", "#E667AF", "#20BFAB"
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L10n.t("server_url_placeholder"), text: $url)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                    TextField(L10n.t("server_url_label"), text: $label)
                }

                Section(L10n.t("appearance")) {
                    HStack(spacing: VostokTheme.spaceSM) {
                        ForEach(colorOptions, id: \.self) { color in
                            Circle()
                                .fill(Color(hex: color))
                                .frame(width: 32, height: 32)
                                .overlay {
                                    if color == selectedColor {
                                        Image(systemName: "checkmark")
                                            .font(.system(size: 14, weight: .bold))
                                            .foregroundStyle(.white)
                                    }
                                }
                                .onTapGesture { selectedColor = color }
                        }
                    }
                    .padding(.vertical, VostokTheme.spaceXS)
                }
            }
            .navigationTitle(L10n.t("add_server"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.t("cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.t("add")) {
                        let resolvedLabel = label.isEmpty ? defaultServerLabel(url) : label
                        onAdd(NewServer(url: url, label: resolvedLabel, color: selectedColor))
                        dismiss()
                    }
                    .disabled(url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private func defaultServerLabel(_ url: String) -> String {
        guard let components = URLComponents(string: normalizeServerURL(url)),
              let host = components.host else {
            return "My Server"
        }
        return host
    }
}
