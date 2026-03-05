import Foundation

@MainActor
final class ChatListViewModel: ObservableObject {
    @Published var chats: [ChatDTO] = []
    @Published var isLoading = false
    @Published var searchQuery = ""
    @Published var errorMessage: String?

    private let chatRepository: ChatRepository
    private let messageRepository: MessageRepository
    private let realtime: PhoenixRealtimeClientProtocol
    private let localStateStore: ChatListLocalStateStore
    private var eventsTask: Task<Void, Never>?
    private var sessionToken: String?
    private var allChats: [ChatDTO] = []
    private var joinedTopics = Set<String>()
    private var userTopic: String?
    private var unreadCounts: [String: Int] = [:]
    private var mutedChatIDs: Set<String> = []
    private var pinnedChatIDs: [String] = []
    private var archivedChatIDs: Set<String> = []
    private static let isoFormatter = ISO8601DateFormatter()

    init(
        chatRepository: ChatRepository,
        messageRepository: MessageRepository,
        realtime: PhoenixRealtimeClientProtocol,
        localStateStore: ChatListLocalStateStore = ChatListLocalStateStore()
    ) {
        self.chatRepository = chatRepository
        self.messageRepository = messageRepository
        self.realtime = realtime
        self.localStateStore = localStateStore

        let restored = localStateStore.load()
        unreadCounts = restored.unreadCounts
        mutedChatIDs = restored.mutedChatIDs
        pinnedChatIDs = restored.pinnedChatIDs
        archivedChatIDs = restored.archivedChatIDs
    }

    deinit {
        eventsTask?.cancel()
        Task {
            await realtime.disconnect()
        }
    }

    func load(token: String) async {
        isLoading = true
        defer { isLoading = false }

        do {
            await messageRepository.flushPendingOutgoing(token: token, chatID: nil)
            allChats = try await chatRepository.fetchChats(token: token)
            applyChatPresentation()
            sessionToken = token
            await syncJoinedTopics()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func connectRealtime(token: String, userID: String?) {
        eventsTask?.cancel()
        sessionToken = token
        if let userID {
            let trimmed = userID.trimmingCharacters(in: .whitespacesAndNewlines)
            userTopic = trimmed.isEmpty ? nil : "user:\(trimmed)"
        } else {
            userTopic = nil
        }
        eventsTask = Task {
            await realtime.connect(token: token)
            await syncJoinedTopics()

            for await event in realtime.events {
                switch event {
                case .connected:
                    await messageRepository.flushPendingOutgoing(token: token, chatID: nil)
                    do {
                        allChats = try await chatRepository.fetchChats(token: token)
                        applyChatPresentation()
                        await syncJoinedTopics()
                    } catch {
                        errorMessage = error.localizedDescription
                    }
                case let .messageNew(chatID, messageID):
                    await messageRepository.applyRealtimeMessageHint(chatID: chatID, messageID: messageID)
                    incrementUnread(chatID: chatID)
                    await refreshIncremental(chatID: chatID, messageID: messageID)
                case let .callState(chatID):
                    postCallEvent(chatID: chatID, kind: .state)
                case let .callParticipantState(chatID):
                    postCallEvent(chatID: chatID, kind: .participantState)
                case let .callSignal(chatID):
                    postCallEvent(chatID: chatID, kind: .signal)
                default:
                    break
                }
            }
        }
    }

    func disconnectRealtime() {
        eventsTask?.cancel()
        eventsTask = nil
        sessionToken = nil
        joinedTopics.removeAll()
        Task { await realtime.disconnect() }
    }

    var filteredChats: [ChatDTO] {
        guard !searchQuery.isEmpty else { return chats }
        return chats.filter {
            $0.title.localizedCaseInsensitiveContains(searchQuery) ||
            $0.participantUsernames.joined(separator: " ").localizedCaseInsensitiveContains(searchQuery)
        }
    }

    func chat(withID chatID: String) -> ChatDTO? {
        allChats.first(where: { $0.id == chatID })
    }

    func unreadCount(chatID: String) -> Int {
        unreadCounts[chatID] ?? 0
    }

    func isMuted(chatID: String) -> Bool {
        mutedChatIDs.contains(chatID)
    }

    func isPinned(chatID: String) -> Bool {
        pinnedChatIDs.contains(chatID)
    }

    func toggleMute(chatID: String) {
        if mutedChatIDs.contains(chatID) {
            mutedChatIDs.remove(chatID)
        } else {
            mutedChatIDs.insert(chatID)
        }
        persistLocalState()
        applyChatPresentation()
    }

    func togglePin(chatID: String) {
        if let index = pinnedChatIDs.firstIndex(of: chatID) {
            pinnedChatIDs.remove(at: index)
        } else {
            pinnedChatIDs.insert(chatID, at: 0)
        }
        persistLocalState()
        applyChatPresentation()
    }

    func archive(chatID: String) {
        archivedChatIDs.insert(chatID)
        unreadCounts.removeValue(forKey: chatID)
        persistLocalState()
        applyChatPresentation()
    }

    func markChatRead(chatID: String) {
        guard unreadCounts[chatID, default: 0] > 0 else { return }
        unreadCounts.removeValue(forKey: chatID)
        persistLocalState()
        applyChatPresentation()
    }

    private func refreshIncremental(chatID: String, messageID: String) async {
        guard let token = sessionToken else { return }
        do {
            _ = try await messageRepository.fetchMessages(token: token, chatID: chatID)
            allChats = try await chatRepository.fetchChats(token: token)
            applyChatPresentation()
            await syncJoinedTopics()
            postMessageEvent(chatID: chatID, messageID: messageID)
        } catch {
            errorMessage = "Realtime sync failed for \(messageID): \(error.localizedDescription)"
        }
    }

    private func syncJoinedTopics() async {
        if let userTopic, !joinedTopics.contains(userTopic) {
            joinedTopics.insert(userTopic)
            await realtime.join(topic: userTopic)
        }

        for chat in allChats {
            let chatTopic = "chat:\(chat.id)"
            if !joinedTopics.contains(chatTopic) {
                joinedTopics.insert(chatTopic)
                await realtime.join(topic: chatTopic)
            }

            let callTopic = "call:\(chat.id)"
            if !joinedTopics.contains(callTopic) {
                joinedTopics.insert(callTopic)
                await realtime.join(topic: callTopic)
            }
        }
    }

    private func postCallEvent(chatID: String, kind: RealtimeCallEventKind) {
        let event = RealtimeCallEvent(chatID: chatID, kind: kind)
        NotificationCenter.default.post(name: .vostokCallEvent, object: nil, userInfo: event.userInfo)
    }

    private func postMessageEvent(chatID: String, messageID: String) {
        let event = RealtimeMessageEvent(chatID: chatID, messageID: messageID)
        NotificationCenter.default.post(name: .vostokMessageEvent, object: nil, userInfo: event.userInfo)
    }

    private func incrementUnread(chatID: String) {
        unreadCounts[chatID, default: 0] += 1
        persistLocalState()
        applyChatPresentation()
    }

    private func persistLocalState() {
        let normalizedUnread = unreadCounts.filter { $0.value > 0 }
        let state = ChatListLocalState(
            unreadCounts: normalizedUnread,
            mutedChatIDs: mutedChatIDs,
            pinnedChatIDs: pinnedChatIDs,
            archivedChatIDs: archivedChatIDs
        )
        localStateStore.save(state)
    }

    private func applyChatPresentation() {
        let visible = allChats.filter { !archivedChatIDs.contains($0.id) }
        let pinnedOrder = Dictionary(uniqueKeysWithValues: pinnedChatIDs.enumerated().map { ($1, $0) })

        chats = visible.sorted { lhs, rhs in
            let leftPinnedIndex = pinnedOrder[lhs.id]
            let rightPinnedIndex = pinnedOrder[rhs.id]

            switch (leftPinnedIndex, rightPinnedIndex) {
            case let (left?, right?):
                if left != right {
                    return left < right
                }
            case (.some, .none):
                return true
            case (.none, .some):
                return false
            case (.none, .none):
                break
            }

            let leftDate = Self.isoFormatter.date(from: lhs.latestMessageAt ?? "") ?? .distantPast
            let rightDate = Self.isoFormatter.date(from: rhs.latestMessageAt ?? "") ?? .distantPast
            if leftDate != rightDate {
                return leftDate > rightDate
            }
            return lhs.id < rhs.id
        }
    }
}
