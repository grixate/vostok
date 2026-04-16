import SwiftUI
import UniformTypeIdentifiers

struct BackupExportView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.vostokContainer) private var container

    @State private var credentialMode: BackupCredentialMode = .quickRestore
    @State private var passphrase = ""
    @State private var passphraseConfirm = ""
    @State private var isExporting = false
    @State private var exportedFileURL: URL?
    @State private var showShareSheet = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(L10n.t("backup"), selection: $credentialMode) {
                        ForEach(BackupCredentialMode.allCases) { mode in
                            Text(mode.displayName).tag(mode)
                        }
                    }
                    .pickerStyle(.menu)
                } footer: {
                    Text(credentialModeDescription)
                        .font(VostokTypography.small)
                }

                Section(L10n.t("backup_password")) {
                    SecureField(L10n.t("password"), text: $passphrase)
                    SecureField(L10n.t("confirm_password"), text: $passphraseConfirm)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(VostokTypography.caption)
                            .foregroundStyle(VostokColors.danger)
                    }
                }

                Section {
                    Button {
                        Task { await exportBackup() }
                    } label: {
                        HStack {
                            Spacer()
                            if isExporting {
                                ProgressView()
                                    .padding(.trailing, VostokTheme.spaceSM)
                            }
                            Text(L10n.t("export_now"))
                            Spacer()
                        }
                    }
                    .disabled(!canExport)
                }
            }
            .navigationTitle(L10n.t("export_backup"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.t("cancel")) { dismiss() }
                }
            }
            .sheet(isPresented: $showShareSheet) {
                if let url = exportedFileURL {
                    ShareSheet(items: [url])
                }
            }
        }
    }

    private var canExport: Bool {
        !isExporting &&
        !passphrase.isEmpty &&
        passphrase == passphraseConfirm
    }

    private var credentialModeDescription: String {
        switch credentialMode {
        case .addressesOnly:
            return "Server addresses only. You'll need to log in again on each server."
        case .quickRestore:
            return "Includes session tokens for quick restore. Tokens may expire."
        case .fullCredentials:
            return "Includes all credentials. Most convenient but less secure."
        }
    }

    private func exportBackup() async {
        isExporting = true
        errorMessage = nil

        do {
            let servers = container.serverStore.load()
            let payload = buildBackupPayload(
                servers: servers,
                credentialMode: credentialMode
            )

            let fileData = try exportBackupFile(payload: payload, passphrase: passphrase)

            // Write to temp file for sharing
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            let filename = "vostok-backup-\(formatter.string(from: Date())).vostok"
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
            try fileData.write(to: tempURL)

            exportedFileURL = tempURL
            isExporting = false
            showShareSheet = true
        } catch {
            errorMessage = error.localizedDescription
            isExporting = false
        }
    }
}

// MARK: – UIKit Share Sheet wrapper

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
