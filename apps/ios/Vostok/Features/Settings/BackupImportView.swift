import SwiftUI
import UniformTypeIdentifiers

struct BackupImportView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.vostokContainer) private var container
    @EnvironmentObject private var appState: AppState

    @State private var selectedFileData: Data?
    @State private var selectedFileName: String?
    @State private var passphrase = ""
    @State private var isDecrypting = false
    @State private var decryptedPayload: BackupPayload?
    @State private var errorMessage: String?
    @State private var showingFilePicker = false
    @State private var isApplying = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button {
                        showingFilePicker = true
                    } label: {
                        HStack {
                            Image(systemName: "doc.badge.plus")
                                .foregroundStyle(VostokColors.accent)
                            Text(selectedFileName ?? L10n.t("select_file"))
                            Spacer()
                            if selectedFileData != nil {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(VostokColors.online)
                            }
                        }
                    }
                }

                if selectedFileData != nil {
                    Section(L10n.t("backup_password")) {
                        SecureField(L10n.t("password"), text: $passphrase)

                        Button {
                            Task { await decryptBackup() }
                        } label: {
                            HStack {
                                Spacer()
                                if isDecrypting {
                                    ProgressView()
                                        .padding(.trailing, VostokTheme.spaceSM)
                                }
                                Text(L10n.t("restore"))
                                Spacer()
                            }
                        }
                        .disabled(passphrase.isEmpty || isDecrypting)
                    }
                }

                if let payload = decryptedPayload {
                    Section(L10n.t("restoring_servers")) {
                        ForEach(payload.servers.indices, id: \.self) { index in
                            let server = payload.servers[index]
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(server.label)
                                        .font(VostokTypography.title)
                                    Text(server.url)
                                        .font(VostokTypography.caption)
                                        .foregroundStyle(VostokColors.labelSecondary)
                                    if !server.username.isEmpty {
                                        Text(server.username)
                                            .font(VostokTypography.small)
                                            .foregroundStyle(VostokColors.labelTertiary)
                                    }
                                }
                                Spacer()
                            }
                        }
                    }

                    Section {
                        Button {
                            Task { await applyBackup(payload) }
                        } label: {
                            HStack {
                                Spacer()
                                if isApplying {
                                    ProgressView()
                                        .padding(.trailing, VostokTheme.spaceSM)
                                }
                                Text(L10n.t("restore"))
                                Spacer()
                            }
                        }
                        .disabled(isApplying)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(VostokTypography.caption)
                            .foregroundStyle(VostokColors.danger)
                    }
                }
            }
            .navigationTitle(L10n.t("restore_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.t("cancel")) { dismiss() }
                }
            }
            .fileImporter(
                isPresented: $showingFilePicker,
                allowedContentTypes: [.vostokBackup, .data],
                onCompletion: handleFileSelection
            )
        }
    }

    private func handleFileSelection(_ result: Result<URL, Error>) {
        switch result {
        case .success(let url):
            guard url.startAccessingSecurityScopedResource() else { return }
            defer { url.stopAccessingSecurityScopedResource() }
            do {
                selectedFileData = try Data(contentsOf: url)
                selectedFileName = url.lastPathComponent

                if !validateBackupMagic(selectedFileData!) {
                    errorMessage = L10n.t("invalid_backup_file")
                    selectedFileData = nil
                    selectedFileName = nil
                } else {
                    errorMessage = nil
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        case .failure(let error):
            errorMessage = error.localizedDescription
        }
    }

    private func decryptBackup() async {
        guard let data = selectedFileData else { return }
        isDecrypting = true
        errorMessage = nil

        do {
            let payload = try importBackupFile(fileBytes: data, passphrase: passphrase)
            decryptedPayload = payload
        } catch {
            errorMessage = error.localizedDescription
        }

        isDecrypting = false
    }

    private func applyBackup(_ payload: BackupPayload) async {
        isApplying = true

        for backupServer in payload.servers {
            let entry = ServerEntry.create(
                url: backupServer.url,
                label: backupServer.label,
                color: backupServer.color
            )

            _ = container.serverStore.add(entry)
            container.createContext(for: entry)

            // If credentials are included, apply auth
            if let token = backupServer.credentials.refreshToken, !token.isEmpty {
                let auth = ServerAuth(
                    token: token,
                    userID: "",
                    username: backupServer.username,
                    deviceID: ""
                )
                appState.applyServerAuth(serverId: entry.id, auth: auth)
            }
        }

        isApplying = false
        dismiss()
    }
}

// MARK: – UTType for .vostok files

extension UTType {
    static let vostokBackup = UTType(exportedAs: "chat.vostok.backup", conformingTo: .data)
}
