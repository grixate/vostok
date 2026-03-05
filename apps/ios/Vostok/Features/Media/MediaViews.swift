import SwiftUI
import PhotosUI

struct MediaLabView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var viewModel: MediaViewModel
    @State private var showingFileImporter = false
    @State private var showingPhotoPicker = false
    @State private var selectedPhotoItem: PhotosPickerItem?

    init(container: AppContainer) {
        _viewModel = StateObject(
            wrappedValue: MediaViewModel(transferService: container.mediaTransferService)
        )
    }

    var body: some View {
        List {
            Section("Upload") {
                TextField("Encrypted note", text: $viewModel.noteText, axis: .vertical)
                    .lineLimit(2...6)

                Button("Upload Note") {
                    withToken { token in
                        Task { await viewModel.uploadNote(token: token) }
                    }
                }
                .buttonStyle(VostokPrimaryButtonStyle())

                Button("Upload Photo or Video") { showingPhotoPicker = true }
                    .buttonStyle(VostokSecondaryButtonStyle())

                Button("Upload File") { showingFileImporter = true }
                    .buttonStyle(VostokSecondaryButtonStyle())
            }

            Section("Fetch / Decrypt") {
                TextField("Upload ID", text: $viewModel.selectedUploadID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                TextField("Key material (base64, optional)", text: $viewModel.manualKeyMaterialBase64, axis: .vertical)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(.footnote, design: .monospaced))

                HStack {
                    Button("Refresh Status") {
                        withToken { token in
                            Task { await viewModel.refreshUploadStatus(token: token) }
                        }
                    }
                    .buttonStyle(VostokSecondaryButtonStyle())

                    Button("Decrypt") {
                        withToken { token in
                            Task { await viewModel.fetchAndDecrypt(token: token) }
                        }
                    }
                    .buttonStyle(VostokPrimaryButtonStyle())
                }
            }

            if let summary = viewModel.lastResultSummary {
                Section("Last Result") {
                    Text(summary)
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.labelSecondary)
                }
            }

            if !viewModel.decryptedPreview.isEmpty {
                Section("Decrypted Preview") {
                    Text(viewModel.decryptedPreview)
                        .font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                }
            }

            Section("Uploads") {
                if viewModel.uploads.isEmpty {
                    Text("No uploads yet")
                        .foregroundStyle(VostokColors.labelSecondary)
                }

                ForEach(viewModel.uploads) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.upload.filename ?? item.id)
                            .font(VostokTypography.bodyEmphasized)
                        Text(item.id)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(VostokColors.labelSecondary)

                        HStack(spacing: 8) {
                            Text(item.status.capitalized)
                            if let count = item.upload.uploadedPartCount {
                                Text("parts: \(count)")
                            }
                            if let bytes = item.upload.uploadedByteSize {
                                Text("bytes: \(bytes)")
                            }
                        }
                        .font(VostokTypography.caption)
                        .foregroundStyle(VostokColors.labelSecondary)

                        if let digest = item.upload.ciphertextSha256 {
                            Text("sha256: \(digest)")
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(VostokColors.labelSecondary)
                                .lineLimit(1)
                        }

                        if let key = item.keyMaterialBase64 {
                            Text("key: \(key)")
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(VostokColors.labelSecondary)
                                .lineLimit(1)
                        }
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        viewModel.selectedUploadID = item.id
                        if let key = item.keyMaterialBase64 {
                            viewModel.manualKeyMaterialBase64 = key
                        }
                    }
                }
            }
        }
        .vostokNavBar(title: "Media Lab", large: false)
        .photosPicker(
            isPresented: $showingPhotoPicker,
            selection: $selectedPhotoItem,
            matching: .any(of: [.images, .videos]),
            preferredItemEncoding: .current
        )
        .fileImporter(
            isPresented: $showingFileImporter,
            allowedContentTypes: [.item],
            onCompletion: handleFileImport
        )
        .task(id: selectedPhotoItem?.itemIdentifier) {
            guard let item = selectedPhotoItem else { return }
            defer { selectedPhotoItem = nil }
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { return }
                let type = item.supportedContentTypes.first
                let kind = AttachmentTypeResolver.mediaKind(for: type)
                let contentType = type?.preferredMIMEType ?? AttachmentTypeResolver.defaultContentType(for: kind)
                let fileExtension = type?.preferredFilenameExtension ?? AttachmentTypeResolver.defaultExtension(for: kind)
                let filename = "\(kind)-\(Int(Date().timeIntervalSince1970)).\(fileExtension)"
                withToken { token in
                    Task {
                        await viewModel.uploadDataBlob(
                            token: token,
                            data: data,
                            filename: filename,
                            contentType: contentType,
                            mediaKind: kind
                        )
                    }
                }
            } catch {
                viewModel.errorMessage = error.localizedDescription
            }
        }
        .overlay {
            if viewModel.isLoading {
                ZStack {
                    Color.black.opacity(0.05).ignoresSafeArea()
                    ProgressView("Working…")
                        .padding(12)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
        }
        .alert("Media Error", isPresented: Binding(
            get: { viewModel.errorMessage != nil },
            set: { show in
                if !show { viewModel.errorMessage = nil }
            })
        ) {
            Button("OK", role: .cancel) {
                viewModel.errorMessage = nil
            }
        } message: {
            Text(viewModel.errorMessage ?? "Unknown error")
        }
    }

    private func withToken(_ action: (String) -> Void) {
        guard case let .authenticated(session) = appState.sessionState else { return }
        action(session.token)
    }

    private func handleFileImport(_ result: Result<URL, Error>) {
        switch result {
        case let .success(url):
            withToken { token in
                Task { await viewModel.uploadFile(token: token, fileURL: url) }
            }
        case let .failure(error):
            viewModel.errorMessage = error.localizedDescription
        }
    }
}

struct ImageViewer: View {
    let image: Image

    var body: some View {
        image
            .resizable()
            .scaledToFit()
            .background(.black)
            .ignoresSafeArea()
    }
}

struct MediaGalleryItem: Identifiable, Hashable {
    enum Kind: String, CaseIterable {
        case media
        case files
        case links
        case voice
    }

    let id: String
    let title: String
    let subtitle: String
    let kind: Kind
    let systemImage: String
}

struct MediaGallery: View {
    let items: [MediaGalleryItem]
    @State private var selectedKind: MediaGalleryItem.Kind = .media

    init(items: [MediaGalleryItem] = []) {
        self.items = items
    }

    var body: some View {
        List {
            Picker("Category", selection: $selectedKind) {
                ForEach(MediaGalleryItem.Kind.allCases, id: \.self) { kind in
                    Text(kind.rawValue.capitalized).tag(kind)
                }
            }
            .pickerStyle(.segmented)
            .listRowSeparator(.hidden)

            if filteredItems.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("No \(selectedKind.rawValue) yet")
                        .font(VostokTypography.bodyEmphasized)
                        .foregroundStyle(VostokColors.labelPrimary)
                    Text("Attachments from this chat will appear here.")
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.labelSecondary)
                }
                .listRowSeparator(.hidden)
            } else {
                ForEach(filteredItems) { item in
                    HStack(spacing: 12) {
                        Image(systemName: item.systemImage)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(VostokColors.accent)
                            .frame(width: 34, height: 34)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(VostokColors.secondaryBackground)
                            )
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.title)
                                .font(VostokTypography.body)
                                .foregroundStyle(VostokColors.labelPrimary)
                            Text(item.subtitle)
                                .font(VostokTypography.caption)
                                .foregroundStyle(VostokColors.labelSecondary)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var filteredItems: [MediaGalleryItem] {
        items.filter { $0.kind == selectedKind }
    }
}

struct MediaPickerSheet: View {
    let onPickPhoto: () -> Void
    let onPickVideo: () -> Void
    let onPickFile: () -> Void

    init(
        onPickPhoto: @escaping () -> Void = {},
        onPickVideo: @escaping () -> Void = {},
        onPickFile: @escaping () -> Void = {}
    ) {
        self.onPickPhoto = onPickPhoto
        self.onPickVideo = onPickVideo
        self.onPickFile = onPickFile
    }

    var body: some View {
        VStack(spacing: 10) {
            Button("Photo") { onPickPhoto() }
                .buttonStyle(VostokSecondaryButtonStyle())
            Button("Video") { onPickVideo() }
                .buttonStyle(VostokSecondaryButtonStyle())
            Button("File") { onPickFile() }
                .buttonStyle(VostokSecondaryButtonStyle())
        }
        .padding()
    }
}
