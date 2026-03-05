import SwiftUI
import UIKit
import AVKit
import PhotosUI
import UniformTypeIdentifiers

struct ConversationView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    let chat: ChatDTO
    private let container: AppContainer

    @StateObject private var viewModel: ConversationViewModel
    @State private var editingMessage: MessageDTO?
    @State private var editDraft = ""
    @State private var deletingMessage: MessageDTO?
    @State private var scrollTargetMessageID: String?
    @State private var showingAttachmentComposer = false
    @State private var previewImage: Image?
    @State private var previewVideoURL: URL?
    @State private var previewText: String?
    @State private var previewTitle = "Attachment"
    @State private var showingAttachmentPreview = false
    @State private var showingPhotoPicker = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var showingFileImporter = false
    @State private var showingRoundVideoCapture = false
    @State private var voiceCache: [String: Data] = [:]
    @State private var activeVoiceUploadID: String?
    @StateObject private var voiceRecorder = VoiceRecorder()
    @StateObject private var voicePlayback = VoicePlaybackManager()

    init(chat: ChatDTO, container: AppContainer) {
        self.chat = chat
        self.container = container
        _viewModel = StateObject(
            wrappedValue: ConversationViewModel(
                repository: container.messageRepository,
                mediaTransferService: container.mediaTransferService,
                apiClient: container.apiClient,
                sessionRuntime: container.signalSessionRuntime
            )
        )
    }

    var body: some View {
        ZStack {
            ConversationWallpaper()

            VStack(spacing: 0) {
                ScrollViewReader { reader in
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(viewModel.messages) { message in
                                bubbleView(for: message)
                                    .id(message.id)
                                    .contextMenu {
                                        Button("Reply") {
                                            viewModel.beginReply(to: message)
                                        }
                                        Button("Copy") {
                                            UIPasteboard.general.string = decode(message.ciphertext) ?? ""
                                        }
                                        Menu("React") {
                                            Button("👍") { react("thumbs_up", message.id) }
                                            Button("❤️") { react("heart", message.id) }
                                            Button("😂") { react("laugh", message.id) }
                                            Button("🔥") { react("fire", message.id) }
                                        }
                                        Button(message.pinnedAt == nil ? "Pin" : "Unpin") {
                                            if case let .authenticated(session) = appState.sessionState {
                                                Task {
                                                    await viewModel.togglePin(
                                                        token: session.token,
                                                        chatID: chat.id,
                                                        messageID: message.id
                                                    )
                                                }
                                            }
                                        }
                                        Button("Edit") {
                                            editingMessage = message
                                            editDraft = decode(message.ciphertext) ?? ""
                                        }
                                        Button("Delete", role: .destructive) {
                                            deletingMessage = message
                                        }
                                    }
                            }
                        }
                        .padding(.vertical, 12)
                    }
                    .onChange(of: viewModel.messages.count) { _ in
                        if let last = viewModel.messages.last {
                            withAnimation { reader.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                    .onChange(of: scrollTargetMessageID) { id in
                        guard let id else { return }
                        withAnimation {
                            reader.scrollTo(id, anchor: .center)
                        }
                        scrollTargetMessageID = nil
                    }
                }

                if voiceRecorder.isRecording {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(.red)
                            .frame(width: 9, height: 9)
                        Text("Recording voice message")
                            .font(VostokTypography.footnote)
                            .foregroundStyle(VostokColors.labelPrimary)
                        Spacer(minLength: 0)
                        Button("Stop") {
                            Task {
                                await toggleVoiceRecording()
                            }
                        }
                        .font(VostokTypography.footnote)
                        .foregroundStyle(VostokColors.accent)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(VostokColors.primaryBackground.opacity(0.75))
                }

                VostokComposer(
                    text: $viewModel.composerText,
                    replyTitle: replyTitle,
                    replyText: replyText,
                    onCancelReply: {
                        viewModel.cancelReply()
                    },
                    onAttach: { showingAttachmentComposer = true },
                    onSend: {
                        Task {
                            await handleComposerSend()
                        }
                    }
                )
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            ConversationTopBar(
                title: chat.title,
                subtitle: conversationSubtitle,
                onBack: { dismiss() }
            ) {
                if chat.type == "group" {
                    HStack(spacing: 8) {
                        NavigationLink {
                            GroupInfoView(chatID: chat.id, container: container)
                        } label: {
                            topCircleIcon(systemName: "person.3.fill")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Open group info")

                        NavigationLink {
                            CallView(chatID: chat.id, container: container)
                        } label: {
                            topCircleIcon(systemName: "phone.fill")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Open call")
                        .accessibilityHint("Opens call controls for this chat")
                    }
                } else {
                    NavigationLink {
                        CallView(chatID: chat.id, container: container)
                    } label: {
                        VostokAvatar(title: chat.title, size: 38, isOnline: true)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open call")
                    .accessibilityHint("Opens call controls for this chat")
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden(true)
        .confirmationDialog("Delete Message", isPresented: Binding(get: {
            deletingMessage != nil
        }, set: { show in
            if !show { deletingMessage = nil }
        })) {
            Button("Delete", role: .destructive) {
                guard let message = deletingMessage else { return }
                deletingMessage = nil
                if case let .authenticated(session) = appState.sessionState {
                    Task {
                        await viewModel.delete(
                            token: session.token,
                            chatID: chat.id,
                            messageID: message.id
                        )
                    }
                }
            }
            Button("Cancel", role: .cancel) {
                deletingMessage = nil
            }
        }
        .confirmationDialog("Attach Media", isPresented: $showingAttachmentComposer) {
            Button("Photo or Video") {
                showingPhotoPicker = true
            }
            Button("Round Video") {
                guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
                    viewModel.errorMessage = "Camera is not available on this device."
                    return
                }
                showingRoundVideoCapture = true
            }
            Button("File") {
                showingFileImporter = true
            }
            Button(voiceRecorder.isRecording ? "Stop Voice Recording" : "Record Voice Message") {
                Task {
                    await toggleVoiceRecording()
                }
            }
            Button("Attach Text File") {
                sendTextAttachment()
            }
            Button("Cancel", role: .cancel) {}
        }
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
        .fullScreenCover(isPresented: $showingRoundVideoCapture) {
            RoundVideoCaptureView { url in
                showingRoundVideoCapture = false
                guard let url else { return }
                Task {
                    await importAndSendFile(at: url, suggestedFilename: "round-\(Int(Date().timeIntervalSince1970)).mov")
                }
            }
            .ignoresSafeArea()
        }
        .sheet(item: $editingMessage) { message in
            NavigationStack {
                Form {
                    Section("Edit Text") {
                        TextField("Message", text: $editDraft, axis: .vertical)
                    }
                }
                .navigationTitle("Edit Message")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            editingMessage = nil
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            guard case let .authenticated(session) = appState.sessionState else { return }
                            Task {
                                await viewModel.edit(
                                    token: session.token,
                                    chatID: chat.id,
                                    message: message,
                                    deviceID: session.deviceID,
                                    updatedText: editDraft
                                )
                                editingMessage = nil
                            }
                        }
                    }
                }
            }
            .presentationDetents([.medium])
        }
        .sheet(isPresented: $showingAttachmentPreview) {
            NavigationStack {
                Group {
                    if let previewImage {
                        ImageViewer(image: previewImage)
                    } else if let previewVideoURL {
                        VideoAttachmentPlayerView(url: previewVideoURL)
                    } else {
                        ScrollView {
                            Text(previewText ?? "No preview available.")
                                .font(.system(.footnote, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(16)
                        }
                    }
                }
                .navigationTitle(previewTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") {
                            showingAttachmentPreview = false
                            cleanupPreviewVideo()
                        }
                    }
                }
            }
        }
        .alert("Message Error", isPresented: Binding(get: {
            viewModel.errorMessage != nil
        }, set: { show in
            if !show { viewModel.errorMessage = nil }
        })) {
            Button("OK", role: .cancel) {
                viewModel.errorMessage = nil
            }
        } message: {
            Text(viewModel.errorMessage ?? "Unknown error")
        }
        .task(id: selectedPhotoItem?.itemIdentifier) {
            guard let item = selectedPhotoItem else { return }
            await handlePickedPhotoItem(item)
        }
        .onChange(of: voicePlayback.isPlaying) { isPlaying in
            if !isPlaying {
                activeVoiceUploadID = nil
            }
        }
        .onChange(of: voiceRecorder.errorMessage) { error in
            if let error {
                viewModel.errorMessage = error
            }
        }
        .onChange(of: voicePlayback.errorMessage) { error in
            if let error {
                viewModel.errorMessage = error
            }
        }
        .task {
            if case let .authenticated(session) = appState.sessionState {
                await viewModel.load(token: session.token, chatID: chat.id)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .vostokMessageEvent)) { notification in
            guard let event = RealtimeMessageEvent(notification: notification),
                  event.chatID == chat.id,
                  case let .authenticated(session) = appState.sessionState
            else {
                return
            }

            Task {
                await viewModel.load(token: session.token, chatID: chat.id)
            }
        }
    }

    private var sessionDeviceID: String {
        if case let .authenticated(session) = appState.sessionState {
            return session.deviceID
        }
        return ""
    }

    private func shortTime(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return "" }
        return date.formatted(date: .omitted, time: .shortened)
    }

    private func decode(_ base64: String?) -> String? {
        guard let base64, let data = Data(base64Encoded: base64) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @ViewBuilder
    private func bubbleView(for message: MessageDTO) -> some View {
        let incoming = message.senderDeviceID != sessionDeviceID
        let payload = decodeAttachmentPayload(message.ciphertext)
        if message.deletedAt != nil {
            VostokMessageBubble(
                text: "Message deleted",
                timestamp: shortTime(message.insertedAt),
                incoming: incoming,
                isEdited: message.editedAt != nil,
                isPinned: message.pinnedAt != nil,
                reactions: message.reactions,
                replyPreview: replyPreview(for: message),
                onReplyTap: replyTapAction(for: message)
            )
            .opacity(0.75)
        } else if let payload, payload.mediaKind == "audio" {
            VostokVoiceBubble(
                duration: voiceDurationText(for: payload),
                timestamp: shortTime(message.insertedAt),
                incoming: incoming,
                isEdited: message.editedAt != nil,
                isPinned: message.pinnedAt != nil,
                reactions: message.reactions,
                isPlaying: activeVoiceUploadID == payload.uploadID && voicePlayback.isPlaying,
                onPlayToggle: {
                    toggleVoicePlayback(payload)
                }
            )
        } else if message.messageKind == "voice" {
            VostokVoiceBubble(
                duration: "0:01",
                timestamp: shortTime(message.insertedAt),
                incoming: incoming,
                isEdited: message.editedAt != nil,
                isPinned: message.pinnedAt != nil,
                reactions: message.reactions,
                isPlaying: false
            )
        } else if (message.messageKind == "media" || message.messageKind == "attachment"),
                  let payload {
            VostokAttachmentBubble(
                filename: payload.filename,
                mediaKind: payload.mediaKind,
                byteSize: payload.byteSize,
                timestamp: shortTime(message.insertedAt),
                incoming: incoming,
                isEdited: message.editedAt != nil,
                isPinned: message.pinnedAt != nil,
                reactions: message.reactions,
                onOpen: {
                    openAttachment(payload)
                }
            )
        } else {
            VostokMessageBubble(
                text: decode(message.ciphertext) ?? "(encrypted)",
                timestamp: shortTime(message.insertedAt),
                incoming: incoming,
                isEdited: message.editedAt != nil,
                isPinned: message.pinnedAt != nil,
                reactions: message.reactions,
                replyPreview: replyPreview(for: message),
                onReplyTap: replyTapAction(for: message)
            )
        }
    }

    private func replyPreview(for message: MessageDTO) -> String? {
        guard let replyID = message.replyToMessageID else { return nil }
        guard let referenced = viewModel.messages.first(where: { $0.id == replyID }) else { return "Reply" }
        if referenced.deletedAt != nil {
            return "Reply: Message deleted"
        }
        if let payload = decodeAttachmentPayload(referenced.ciphertext) {
            if payload.mediaKind == "audio" {
                return "Reply: Voice message"
            }
            return "Reply: \(payload.filename)"
        }
        let text = decode(referenced.ciphertext) ?? referenced.messageKind.capitalized
        return "Reply: \(text)"
    }

    private func replyTapAction(for message: MessageDTO) -> (() -> Void)? {
        guard let replyID = message.replyToMessageID else { return nil }
        return {
            scrollTargetMessageID = replyID
        }
    }

    private func replySnippet(for message: MessageDTO) -> String {
        if message.deletedAt != nil { return "Message deleted" }
        if let payload = decodeAttachmentPayload(message.ciphertext) {
            if payload.mediaKind == "audio" {
                return "Voice message"
            }
            return payload.filename
        }
        return decode(message.ciphertext) ?? message.messageKind.capitalized
    }

    private var replyTitle: String? {
        guard let target = viewModel.replyTarget else { return nil }
        let sender = target.senderDeviceID == sessionDeviceID ? "You" : chat.title
        return "Reply to \(sender)"
    }

    private var replyText: String? {
        guard let target = viewModel.replyTarget else { return nil }
        return replySnippet(for: target)
    }

    private func react(_ key: String, _ messageID: String) {
        guard case let .authenticated(session) = appState.sessionState else { return }
        Task {
            await viewModel.toggleReaction(
                token: session.token,
                chatID: chat.id,
                messageID: messageID,
                reactionKey: key
            )
        }
    }

    private func decodeAttachmentPayload(_ base64: String?) -> AttachmentCipherPayload? {
        guard let base64, let data = Data(base64Encoded: base64) else { return nil }
        return try? JSONDecoder().decode(AttachmentCipherPayload.self, from: data)
    }

    private func sendTextAttachment() {
        let text = viewModel.composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        let payloadText = text.isEmpty ? "Vostok attachment \(ISO8601DateFormatter().string(from: Date()))" : text
        sendAttachment(
            filename: "note-\(Int(Date().timeIntervalSince1970)).txt",
            contentType: "text/plain",
            mediaKind: "file",
            data: Data(payloadText.utf8)
        )
    }

    private func openAttachment(_ payload: AttachmentCipherPayload) {
        if payload.mediaKind == "audio" {
            toggleVoicePlayback(payload)
            return
        }

        guard let session = currentSession else { return }

        Task {
            do {
                let data = try await viewModel.downloadAttachment(token: session.token, payload: payload)
                previewTitle = payload.filename

                if payload.mediaKind == "image", let uiImage = UIImage(data: data) {
                    previewImage = Image(uiImage: uiImage)
                    cleanupPreviewVideo()
                    previewVideoURL = nil
                    previewText = nil
                } else if payload.mediaKind == "video" {
                    cleanupPreviewVideo()
                    previewImage = nil
                    previewText = nil
                    previewVideoURL = try writePreviewVideo(data: data, filename: payload.filename)
                } else if let text = String(data: data, encoding: .utf8) {
                    previewImage = nil
                    cleanupPreviewVideo()
                    previewVideoURL = nil
                    previewText = text
                } else {
                    previewImage = nil
                    cleanupPreviewVideo()
                    previewVideoURL = nil
                    previewText = "Binary attachment (\(data.count) bytes)."
                }

                showingAttachmentPreview = true
            } catch {
                viewModel.errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func handleComposerSend() async {
        guard let session = currentSession else { return }

        if viewModel.composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            await toggleVoiceRecording()
        } else {
            await viewModel.send(token: session.token, chatID: chat.id, deviceID: session.deviceID)
        }
    }

    @MainActor
    private func toggleVoiceRecording() async {
        guard let session = currentSession else { return }

        if voiceRecorder.isRecording {
            voiceRecorder.stop()
            await sendRecordedVoiceIfNeeded(session: session)
        } else {
            await voiceRecorder.start()
        }
    }

    @MainActor
    private func sendRecordedVoiceIfNeeded(session: AppState.SessionContext) async {
        guard let url = voiceRecorder.outputURL else { return }

        do {
            let data = try Data(contentsOf: url)
            guard !data.isEmpty else { return }
            await viewModel.uploadAttachmentAndSend(
                token: session.token,
                chatID: chat.id,
                deviceID: session.deviceID,
                filename: "voice-\(Int(Date().timeIntervalSince1970)).m4a",
                contentType: "audio/mp4",
                mediaKind: "audio",
                plaintext: data
            )
            try? FileManager.default.removeItem(at: url)
        } catch {
            viewModel.errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func sendAttachment(filename: String, contentType: String, mediaKind: String, data: Data) {
        guard let session = currentSession else { return }

        Task {
            await viewModel.uploadAttachmentAndSend(
                token: session.token,
                chatID: chat.id,
                deviceID: session.deviceID,
                filename: filename,
                contentType: contentType,
                mediaKind: mediaKind,
                plaintext: data
            )
        }
    }

    @MainActor
    private func handlePickedPhotoItem(_ item: PhotosPickerItem) async {
        defer { selectedPhotoItem = nil }

        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                viewModel.errorMessage = "Unable to load selected media."
                return
            }

            let type = item.supportedContentTypes.first
            let mediaKind = AttachmentTypeResolver.mediaKind(for: type)
            let contentType = type?.preferredMIMEType ?? AttachmentTypeResolver.defaultContentType(for: mediaKind)
            let fileExtension = type?.preferredFilenameExtension ?? AttachmentTypeResolver.defaultExtension(for: mediaKind)
            let filename = "\(mediaKind)-\(Int(Date().timeIntervalSince1970)).\(fileExtension)"
            sendAttachment(filename: filename, contentType: contentType, mediaKind: mediaKind, data: data)
        } catch {
            viewModel.errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func handleFileImport(_ result: Result<URL, Error>) {
        switch result {
        case let .success(url):
            Task {
                await importAndSendFile(at: url, suggestedFilename: nil)
            }
        case let .failure(error):
            viewModel.errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func importAndSendFile(at url: URL, suggestedFilename: String?) async {

        let hasScopedAccess = url.startAccessingSecurityScopedResource()
        defer {
            if hasScopedAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let data = try Data(contentsOf: url)
            let resourceValues = try? url.resourceValues(forKeys: [.contentTypeKey])
            let type = resourceValues?.contentType ?? UTType(filenameExtension: url.pathExtension)
            let mediaKind = AttachmentTypeResolver.mediaKind(for: type)
            let contentType = type?.preferredMIMEType ?? AttachmentTypeResolver.defaultContentType(for: mediaKind)
            let fallbackExtension = AttachmentTypeResolver.defaultExtension(for: mediaKind)
            let resolvedName = suggestedFilename ?? url.lastPathComponent
            let filename = resolvedName.isEmpty
                ? "\(mediaKind)-\(Int(Date().timeIntervalSince1970)).\(fallbackExtension)"
                : resolvedName

            sendAttachment(filename: filename, contentType: contentType, mediaKind: mediaKind, data: data)
        } catch {
            viewModel.errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func toggleVoicePlayback(_ payload: AttachmentCipherPayload) {
        if activeVoiceUploadID == payload.uploadID, voicePlayback.isPlaying {
            voicePlayback.stop()
            activeVoiceUploadID = nil
            return
        }

        guard let session = currentSession else { return }

        Task {
            do {
                let data: Data
                if let cached = voiceCache[payload.uploadID] {
                    data = cached
                } else {
                    data = try await viewModel.downloadAttachment(token: session.token, payload: payload)
                    voiceCache[payload.uploadID] = data
                }

                activeVoiceUploadID = payload.uploadID
                voicePlayback.play(data: data)
            } catch {
                viewModel.errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func voiceDurationText(for payload: AttachmentCipherPayload) -> String {
        if let data = voiceCache[payload.uploadID] {
            return voicePlayback.durationText(for: data)
        }

        guard let byteSize = payload.byteSize else { return "0:00" }
        let approximateSeconds = max(1, Int((Double(byteSize) / 12_000.0).rounded()))
        return formatDuration(approximateSeconds)
    }

    private var conversationSubtitle: String {
        if chat.type == "group" {
            let members = max(1, chat.participantUsernames.count)
            return "\(members) members"
        }
        return "last seen recently"
    }

    private func topCircleIcon(systemName: String) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(VostokColors.controlPrimary)
            .frame(width: 38, height: 38)
            .background(.ultraThinMaterial, in: Circle())
            .overlay(
                Circle()
                    .stroke(VostokColors.separatorVibrant.opacity(0.45), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.08), radius: 10, y: 2)
    }

    private var currentSession: AppState.SessionContext? {
        if case let .authenticated(session) = appState.sessionState {
            return session
        }
        return nil
    }

    private func writePreviewVideo(data: Data, filename: String) throws -> URL {
        let base = FileManager.default.temporaryDirectory
        let ext = (filename as NSString).pathExtension.isEmpty ? "mov" : (filename as NSString).pathExtension
        let url = base.appendingPathComponent("preview-\(UUID().uuidString).\(ext)")
        try data.write(to: url, options: .atomic)
        return url
    }

    private func cleanupPreviewVideo() {
        if let previewVideoURL {
            try? FileManager.default.removeItem(at: previewVideoURL)
            self.previewVideoURL = nil
        }
    }

    private func formatDuration(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

private struct ConversationWallpaper: View {
    private let symbols = [
        "leaf.fill",
        "heart.fill",
        "paperplane.fill",
        "star.fill",
        "moon.fill",
        "fish.fill",
        "pawprint.fill",
        "bolt.fill"
    ]

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                VostokColors.chatWallpaperBase
                LinearGradient(
                    colors: [
                        Color.yellow.opacity(0.18),
                        Color.green.opacity(0.08),
                        Color.blue.opacity(0.08)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )

                ForEach(0..<rowCount(height: proxy.size.height), id: \.self) { row in
                    ForEach(0..<columnCount(width: proxy.size.width), id: \.self) { column in
                        let index = row * 19 + column * 7
                        Image(systemName: symbols[index % symbols.count])
                            .font(.system(size: CGFloat(12 + (index % 10))))
                            .foregroundStyle(.black.opacity(0.09))
                            .rotationEffect(.degrees(Double((index % 50) - 25)))
                            .position(
                                x: CGFloat(column) * 60 + (row % 2 == 0 ? 26 : 46),
                                y: CGFloat(row) * 62 + 22
                            )
                    }
                }

                LinearGradient(
                    colors: [Color.white.opacity(0.36), .clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(maxHeight: .infinity, alignment: .top)

                LinearGradient(
                    colors: [.clear, Color.white.opacity(0.24)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
            .ignoresSafeArea()
        }
    }

    private func columnCount(width: CGFloat) -> Int {
        Int(width / 60) + 3
    }

    private func rowCount(height: CGFloat) -> Int {
        Int(height / 62) + 4
    }
}

private struct ConversationTopBar<Trailing: View>: View {
    let title: String
    let subtitle: String
    let onBack: () -> Void
    let trailing: () -> Trailing

    init(
        title: String,
        subtitle: String,
        onBack: @escaping () -> Void,
        @ViewBuilder trailing: @escaping () -> Trailing
    ) {
        self.title = title
        self.subtitle = subtitle
        self.onBack = onBack
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .center) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(VostokColors.controlPrimary)
                    .frame(width: 38, height: 38)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .overlay(
                Circle()
                    .stroke(VostokColors.separatorVibrant.opacity(0.45), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.08), radius: 10, y: 2)
            .accessibilityLabel("Back")

            Spacer(minLength: 12)

            VStack(spacing: 0) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(VostokColors.labelPrimary.opacity(0.85))
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(VostokColors.labelSecondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(
                Capsule()
                    .stroke(VostokColors.separatorVibrant.opacity(0.45), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.08), radius: 10, y: 2)

            Spacer(minLength: 12)

            trailing()
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .background(
            LinearGradient(
                colors: [Color.white.opacity(0.55), Color.white.opacity(0)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
}

private struct VideoAttachmentPlayerView: View {
    let url: URL
    @State private var player: AVPlayer

    init(url: URL) {
        self.url = url
        _player = State(initialValue: AVPlayer(url: url))
    }

    var body: some View {
        VideoPlayer(player: player)
            .onAppear {
                player.play()
            }
            .onDisappear {
                player.pause()
            }
    }
}
