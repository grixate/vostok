import SwiftUI

private enum ChatFolder: CaseIterable, Identifiable {
    case all
    case channels
    case bots

    var id: Self { self }

    var title: String {
        switch self {
        case .all: return "All"
        case .channels: return "Channels"
        case .bots: return "Bots"
        }
    }
}

struct ChatListView: View {
    @EnvironmentObject private var appState: AppState
    private let container: AppContainer

    @StateObject private var viewModel: ChatListViewModel
    @State private var navigationPath = NavigationPath()
    @State private var routedChat: ChatDTO?
    @State private var isRoutedChatPresented = false
    @State private var isCreateGroupPresented = false
    @State private var isNewDirectChatPresented = false
    @State private var showCreateActionSheet = false
    @State private var selectedFolder: ChatFolder = .all
    @State private var realtimeSnapshot = RealtimeDiagnosticsSnapshot()

    private static let isoFormatter = ISO8601DateFormatter()
    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()
    private static let weekdayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE"
        return formatter
    }()
    private static let monthDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter
    }()

    init(container: AppContainer) {
        self.container = container
        _viewModel = StateObject(
            wrappedValue: ChatListViewModel(
                chatRepository: container.chatRepository,
                messageRepository: container.messageRepository,
                realtime: container.realtimeClient
            )
        )
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            List {
                ForEach(Array(folderFilteredChats.enumerated()), id: \.element.id) { index, chat in
                    Button {
                        if case let .authenticated(session) = appState.sessionState {
                            Task {
                                await viewModel.syncReadState(token: session.token, chatID: chat.id)
                            }
                        } else {
                            viewModel.markChatRead(chatID: chat.id)
                        }
                        navigationPath.append(chat)
                    } label: {
                        let isSaved = chat.isSelfChat
                        VostokListRow(
                            title: chat.title,
                            subtitle: isSaved ? (viewModel.lastMessagePreview(chatID: chat.id) ?? "Your Cloud Storage") : rowSubtitle(for: chat),
                            subtitleSymbol: isSaved ? nil : rowSubtitleSymbol(for: chat),
                            trailing: isSaved ? "" : relativeDate(chat.latestMessageAt),
                            unreadCount: isSaved ? 0 : viewModel.unreadCount(chatID: chat.id),
                            isMuted: viewModel.isMuted(chatID: chat.id),
                            isPinned: viewModel.isPinned(chatID: chat.id),
                            showsReadIndicator: isSaved ? false : shouldShowReadIndicator(for: chat),
                            showsSeparator: index != 0,
                            leadingSystemImage: isSaved ? "bookmark.fill" : nil
                        )
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(EdgeInsets())
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if !chat.isSelfChat {
                            Button(viewModel.isPinned(chatID: chat.id) ? "Unpin" : "Pin") {
                                viewModel.togglePin(chatID: chat.id)
                            }
                            .tint(.orange)

                            Button(viewModel.isMuted(chatID: chat.id) ? "Unmute" : "Mute") {
                                viewModel.toggleMute(chatID: chat.id)
                            }
                            .tint(.gray)

                            Button("Archive") {
                                viewModel.archive(chatID: chat.id)
                            }
                            .tint(.indigo)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(VostokColors.secondaryBackground)
            .refreshable {
                if case let .authenticated(session) = appState.sessionState {
                    await viewModel.load(token: session.token)
                }
            }
            .overlay {
                if viewModel.isLoading {
                    ProgressView()
                }
            }
            .confirmationDialog("New Conversation", isPresented: $showCreateActionSheet, titleVisibility: .visible) {
                Button("New Chat") { isNewDirectChatPresented = true }
                Button("New Group") { isCreateGroupPresented = true }
                Button("Cancel", role: .cancel) {}
            }
            .navigationDestination(for: ChatDTO.self) { chat in
                ConversationView(chat: chat, container: container)
            }
            .navigationDestination(isPresented: $isRoutedChatPresented) {
                if let chat = routedChat {
                    ConversationView(chat: chat, container: container)
                } else {
                    EmptyView()
                }
            }
            .navigationDestination(isPresented: $isCreateGroupPresented) {
                CreateGroupView(container: container)
            }
            .sheet(isPresented: $isNewDirectChatPresented, onDismiss: {
                if routedChat != nil {
                    isRoutedChatPresented = true
                }
            }) {
                NewDirectChatView(container: container) { chat in
                    routedChat = chat
                    isNewDirectChatPresented = false
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: $viewModel.searchQuery,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search"
            )
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 2) {
                        Text("Chats")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(VostokColors.labelPrimary)
                        HStack(spacing: 5) {
                            Circle()
                                .fill(realtimeStatusColor)
                                .frame(width: 7, height: 7)
                            Text(realtimeStatusText)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(VostokColors.labelSecondary)
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Chats, \(realtimeStatusText)")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { showCreateActionSheet = true }) {
                        Image(systemName: "square.and.pencil")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(VostokColors.accent)
                    }
                    .accessibilityLabel("New conversation")
                }
            }
            .task {
                if case let .authenticated(session) = appState.sessionState {
                    await viewModel.load(token: session.token)
                    viewModel.connectRealtime(token: session.token, userID: session.userID)
                    await routeIfNeeded()
                }
            }
            .onChange(of: appState.selectedChatID) { _ in
                Task {
                    await routeIfNeeded()
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .vostokChatReadEvent)) { notification in
                guard let event = RealtimeChatReadEvent(notification: notification) else { return }
                viewModel.markChatRead(chatID: event.chatID)
            }
            .task {
                await monitorRealtimeDiagnostics()
            }
        }
    }

    // MARK: - Realtime status

    private var realtimeStatusText: String {
        if !realtimeSnapshot.networkAvailable {
            return "Offline"
        }
        switch realtimeSnapshot.connectionState {
        case .connected:
            return "Connected"
        case .reconnecting:
            return "Reconnecting"
        case .connecting:
            return "Connecting"
        case .paused:
            return "Paused"
        case .disconnected:
            return "Disconnected"
        }
    }

    private var realtimeStatusColor: Color {
        if !realtimeSnapshot.networkAvailable {
            return VostokColors.danger
        }
        switch realtimeSnapshot.connectionState {
        case .connected:
            return VostokColors.online
        case .reconnecting, .connecting:
            return .orange
        case .paused, .disconnected:
            return VostokColors.labelSecondary
        }
    }

    // MARK: - Helpers

    private var channelCount: Int {
        viewModel.filteredChats.filter { $0.type == "channel" }.count
    }

    private var folderFilteredChats: [ChatDTO] {
        viewModel.filteredChats.filter { chat in
            switch selectedFolder {
            case .all:
                return true
            case .channels:
                return chat.type == "channel"
            case .bots:
                return chat.title.localizedCaseInsensitiveContains("bot") ||
                    chat.participantUsernames.contains(where: { $0.localizedCaseInsensitiveContains("bot") })
            }
        }
    }

    private func rowSubtitle(for chat: ChatDTO) -> String {
        if let preview = viewModel.lastMessagePreview(chatID: chat.id) {
            return preview
        }
        if !chat.participantUsernames.isEmpty {
            return chat.participantUsernames.joined(separator: ", ")
        }
        return chat.type.capitalized
    }

    private func rowSubtitleSymbol(for chat: ChatDTO) -> String? {
        if chat.title.localizedCaseInsensitiveContains("video") {
            return "play.circle.fill"
        }
        switch chat.type {
        case "channel":
            return "megaphone.fill"
        case "group":
            return "person.2.fill"
        default:
            return nil
        }
    }

    private func shouldShowReadIndicator(for chat: ChatDTO) -> Bool {
        chat.type == "direct" && viewModel.unreadCount(chatID: chat.id) == 0
    }

    private func relativeDate(_ iso: String?) -> String {
        guard let iso, let date = Self.isoFormatter.date(from: iso) else { return "" }
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return Self.timeFormatter.string(from: date)
        }

        if let days = calendar.dateComponents([.day], from: date, to: Date()).day, days < 7 {
            return Self.weekdayFormatter.string(from: date)
        }

        return Self.monthDayFormatter.string(from: date)
    }

    @MainActor
    private func routeIfNeeded() async {
        guard let requestedChatID = appState.selectedChatID else { return }
        defer { appState.consumeChatNavigation() }
        guard case let .authenticated(session) = appState.sessionState else { return }

        if let existing = viewModel.chat(withID: requestedChatID) {
            routedChat = existing
            isRoutedChatPresented = true
            await viewModel.syncReadState(token: session.token, chatID: requestedChatID)
            return
        }

        await viewModel.load(token: session.token)
        if let loaded = viewModel.chat(withID: requestedChatID) {
            routedChat = loaded
            isRoutedChatPresented = true
            await viewModel.syncReadState(token: session.token, chatID: requestedChatID)
        } else {
            viewModel.errorMessage = "Unable to open chat \(requestedChatID)."
        }
    }

    @MainActor
    private func monitorRealtimeDiagnostics() async {
        while !Task.isCancelled {
            realtimeSnapshot = await container.realtimeClient.snapshotDiagnostics()
            try? await Task.sleep(for: .seconds(2))
        }
    }
}

// MARK: - New Direct Chat Sheet

struct NewDirectChatView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    private let container: AppContainer
    let onChatCreated: (ChatDTO) -> Void

    @StateObject private var viewModel: ContactListViewModel

    init(container: AppContainer, onChatCreated: @escaping (ChatDTO) -> Void) {
        self.container = container
        self.onChatCreated = onChatCreated
        _viewModel = StateObject(
            wrappedValue: ContactListViewModel(
                apiClient: container.apiClient,
                chatRepository: container.chatRepository
            )
        )
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(viewModel.filteredMembers, id: \.id) { member in
                    Button {
                        startChat(with: member.username)
                    } label: {
                        HStack(spacing: 10) {
                            VostokAvatar(title: member.username)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(member.username)
                                    .font(VostokTypography.bodyEmphasized)
                                Text("@\(member.username)")
                                    .font(VostokTypography.footnote)
                                    .foregroundStyle(VostokColors.labelSecondary)
                            }
                            Spacer()
                        }
                    }
                    .buttonStyle(.plain)
                }

                if let error = viewModel.errorMessage {
                    Section {
                        Text(error)
                            .font(VostokTypography.footnote)
                            .foregroundStyle(VostokColors.danger)
                    }
                }
            }
            .searchable(text: $viewModel.searchQuery, prompt: "Search members")
            .overlay {
                if viewModel.isLoading {
                    ProgressView()
                } else if viewModel.members.isEmpty && !viewModel.isLoading {
                    VStack(spacing: 8) {
                        Image(systemName: "person.crop.circle.badge.questionmark")
                            .font(.system(size: 32))
                            .foregroundStyle(VostokColors.labelSecondary)
                        Text("No Members")
                            .font(VostokTypography.bodyEmphasized)
                            .foregroundStyle(VostokColors.labelSecondary)
                    }
                }
            }
            .navigationTitle("New Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task { await loadMembers() }
        }
    }

    private func loadMembers() async {
        guard case let .authenticated(session) = appState.sessionState else { return }
        await viewModel.load(token: session.token, currentUsername: session.username)
    }

    private func startChat(with username: String) {
        guard case let .authenticated(session) = appState.sessionState else { return }
        Task {
            do {
                let chat = try await viewModel.createDirectChat(token: session.token, username: username)
                onChatCreated(chat)
            } catch {
                viewModel.errorMessage = error.localizedDescription
            }
        }
    }
}
