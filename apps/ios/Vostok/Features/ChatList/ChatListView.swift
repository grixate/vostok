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
    @State private var routedChat: ChatDTO?
    @State private var isRoutedChatPresented = false
    @State private var isCreateGroupPresented = false
    @State private var selectedFolder: ChatFolder = .all
    @State private var showsSearch = false
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
        List {
            ForEach(Array(folderFilteredChats.enumerated()), id: \.element.id) { index, chat in
                NavigationLink(value: chat) {
                    VostokListRow(
                        title: chat.title,
                        subtitle: rowSubtitle(for: chat),
                        subtitleSymbol: rowSubtitleSymbol(for: chat),
                        trailing: relativeDate(chat.latestMessageAt),
                        unreadCount: viewModel.unreadCount(chatID: chat.id),
                        isMuted: viewModel.isMuted(chatID: chat.id),
                        isPinned: viewModel.isPinned(chatID: chat.id),
                        showsReadIndicator: shouldShowReadIndicator(for: chat),
                        showsSeparator: index != 0
                    )
                }
                .simultaneousGesture(TapGesture().onEnded {
                    guard case let .authenticated(session) = appState.sessionState else {
                        viewModel.markChatRead(chatID: chat.id)
                        return
                    }
                    Task {
                        await viewModel.syncReadState(token: session.token, chatID: chat.id)
                    }
                })
                .listRowInsets(EdgeInsets())
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
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
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(VostokColors.secondaryBackground)
        .safeAreaInset(edge: .top, spacing: 0) {
            ChatListHeader(
                selectedFolder: selectedFolder,
                channelCount: channelCount,
                showsSearchField: showsSearch,
                realtimeSnapshot: realtimeSnapshot,
                searchQuery: $viewModel.searchQuery,
                onSelectFolder: { selectedFolder = $0 },
                onEditTap: {},
                onCreateGroupTap: { isCreateGroupPresented = true },
                onSearchTap: { withAnimation(.easeInOut(duration: 0.2)) { showsSearch.toggle() } }
            )
        }
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
        .toolbar(.hidden, for: .navigationBar)
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

private struct ChatListHeader: View {
    let selectedFolder: ChatFolder
    let channelCount: Int
    let showsSearchField: Bool
    let realtimeSnapshot: RealtimeDiagnosticsSnapshot
    @Binding var searchQuery: String
    let onSelectFolder: (ChatFolder) -> Void
    let onEditTap: () -> Void
    let onCreateGroupTap: () -> Void
    let onSearchTap: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            HStack(alignment: .center) {
                Button(action: onEditTap) {
                    Text("Edit")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(VostokColors.controlPrimary)
                        .padding(.horizontal, 16)
                        .frame(height: 44)
                }
                .buttonStyle(.plain)
                .background(glassCapsuleBackground)
                .accessibilityLabel("Edit chats")

                Spacer(minLength: 8)

                VStack(spacing: 3) {
                    HStack(spacing: 4) {
                        storiesBadge
                        Text("Chats")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(VostokColors.labelPrimary)
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(VostokColors.accent)
                    }

                    realtimeStatusBadge
                }

                Spacer(minLength: 8)

                HStack(spacing: 8) {
                    buttonCircle(systemName: "plus", action: onCreateGroupTap, label: "Create group")
                    buttonCircle(systemName: "square.and.pencil", action: onSearchTap, label: "Search")
                }
            }
            .padding(.horizontal, 16)

            folderControl
                .padding(.horizontal, 16)

            if showsSearchField {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(VostokColors.labelSecondary)
                    TextField("Search", text: $searchQuery)
                        .font(.system(size: 15, weight: .regular))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 12)
                .frame(height: 40)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(VostokColors.surfaceTertiary)
                )
                .padding(.horizontal, 16)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(
            LinearGradient(
                colors: [VostokColors.primaryBackground, VostokColors.primaryBackground.opacity(0)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private var folderControl: some View {
        HStack(spacing: 0) {
            ForEach(ChatFolder.allCases) { folder in
                Button {
                    onSelectFolder(folder)
                } label: {
                    HStack(spacing: 5) {
                        Text(folder.title)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(VostokColors.labelPrimary)
                        if folder == .channels && channelCount > 0 {
                            Text("\(channelCount)")
                                .font(.system(size: 13, weight: .regular))
                                .foregroundStyle(.black)
                                .frame(minWidth: 18)
                                .padding(.horizontal, 4)
                                .frame(height: 18)
                                .background(VostokColors.accent, in: Capsule())
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 35)
                    .background {
                        if selectedFolder == folder {
                            Capsule(style: .continuous)
                                .fill(VostokColors.surfaceTertiary)
                                .padding(1)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(glassCapsuleBackground)
        .clipShape(Capsule(style: .continuous))
    }

    private var storiesBadge: some View {
        HStack(spacing: -8) {
            Circle()
                .fill(.cyan.opacity(0.9))
                .frame(width: 24, height: 24)
                .overlay(Circle().stroke(.white, lineWidth: 1.4))
            Circle()
                .fill(.yellow.opacity(0.9))
                .frame(width: 24, height: 24)
                .overlay(Circle().stroke(.white, lineWidth: 1.4))
            Circle()
                .fill(.pink.opacity(0.9))
                .frame(width: 24, height: 24)
                .overlay(Circle().stroke(.white, lineWidth: 1.4))
        }
    }

    private var realtimeStatusBadge: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)
            Text(statusText)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(VostokColors.labelSecondary)
        }
        .padding(.horizontal, 8)
        .frame(height: 20)
        .background(
            Capsule(style: .continuous)
                .fill(VostokColors.surfaceTertiary.opacity(0.9))
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Realtime status")
        .accessibilityValue(statusText)
    }

    private var glassCapsuleBackground: some View {
        Capsule(style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay(
                Capsule(style: .continuous)
                    .fill(VostokColors.glassLight.opacity(0.6))
            )
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(VostokColors.separatorVibrant.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.08), radius: 16, y: 4)
    }

    private func buttonCircle(systemName: String, action: @escaping () -> Void, label: String) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(VostokColors.controlPrimary)
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .background(glassCapsuleBackground)
        .clipShape(Circle())
        .accessibilityLabel(label)
    }

    private var statusText: String {
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

    private var statusColor: Color {
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
}
