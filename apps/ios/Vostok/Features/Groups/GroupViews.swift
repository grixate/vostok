import SwiftUI

// MARK: – Create Group View

struct CreateGroupView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    private let container: AppContainer

    @State private var title = ""
    @State private var searchQuery = ""
    @State private var selectedUsernames: Set<String> = []
    @StateObject private var membersViewModel: ContactListViewModel
    @StateObject private var groupViewModel: GroupViewModel

    init(container: AppContainer) {
        self.container = container
        _membersViewModel = StateObject(
            wrappedValue: ContactListViewModel(
                apiClient: container.apiClient,
                chatRepository: container.chatRepository
            )
        )
        _groupViewModel = StateObject(
            wrappedValue: GroupViewModel(repository: container.chatRepository, apiClient: container.apiClient)
        )
    }

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canCreate: Bool {
        !trimmedTitle.isEmpty && !selectedUsernames.isEmpty && !groupViewModel.isLoading
    }

    private var filteredMembers: [UserDTO] {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return membersViewModel.members }
        return membersViewModel.members.filter { $0.username.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        List {
            Section {
                TextField(L10n.t("group_name"), text: $title)
                    .textInputAutocapitalization(.sentences)
            }

            Section {
                if !selectedUsernames.isEmpty {
                    selectedMembersChips
                }
            } header: {
                Text(selectedUsernames.isEmpty
                     ? L10n.t("add_members")
                     : "\(L10n.t("members")) (\(selectedUsernames.count))")
            }

            Section {
                membersList
            }

            if let error = groupViewModel.lastError {
                Section {
                    Text(error)
                        .font(VostokTypography.caption)
                        .foregroundStyle(VostokColors.danger)
                }
            }
        }
        .searchable(text: $searchQuery, prompt: L10n.t("search_members"))
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if groupViewModel.isLoading {
                    ProgressView()
                } else {
                    Button(L10n.t("done")) { createGroup() }
                        .disabled(!canCreate)
                        .fontWeight(.semibold)
                }
            }
        }
        .vostokNavBar(title: L10n.t("new_group"), large: false)
        .task { await loadMembers() }
    }

    private var selectedMembersChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: VostokTheme.spaceMD) {
                ForEach(Array(selectedUsernames).sorted(), id: \.self) { username in
                    VStack(spacing: VostokTheme.spaceXS) {
                        ZStack(alignment: .topTrailing) {
                            VostokAvatar(title: username, size: VostokTheme.avatarList)
                            Button { selectedUsernames.remove(username) } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.system(size: 18))
                                    .foregroundStyle(VostokColors.labelSecondary)
                                    .background(Circle().fill(VostokColors.primaryBackground))
                            }
                            .offset(x: 4, y: -4)
                        }
                        Text(username)
                            .font(VostokTypography.small)
                            .lineLimit(1)
                    }
                }
            }
            .padding(.vertical, VostokTheme.spaceSM)
        }
    }

    @ViewBuilder
    private var membersList: some View {
        if membersViewModel.isLoading {
            HStack { Spacer(); ProgressView(); Spacer() }
        } else {
            ForEach(filteredMembers, id: \.id) { member in
                Button { toggleMember(member.username) } label: {
                    memberRow(member)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func memberRow(_ member: UserDTO) -> some View {
        HStack(spacing: VostokTheme.spaceSM) {
            VostokAvatar(title: member.username)
            VStack(alignment: .leading, spacing: 2) {
                Text(member.username)
                    .font(VostokTypography.bodyBold)
                    .foregroundStyle(VostokColors.labelPrimary)
            }
            Spacer()
            Image(systemName: selectedUsernames.contains(member.username) ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 22))
                .foregroundStyle(selectedUsernames.contains(member.username) ? VostokColors.accent : VostokColors.labelTertiary)
        }
    }

    private func toggleMember(_ username: String) {
        if selectedUsernames.contains(username) {
            selectedUsernames.remove(username)
        } else {
            selectedUsernames.insert(username)
        }
    }

    private func loadMembers() async {
        guard case let .authenticated(session) = appState.sessionState else { return }
        await membersViewModel.load(token: session.token, currentUsername: session.username)
    }

    private func createGroup() {
        guard case let .authenticated(session) = appState.sessionState else { return }
        Task {
            await groupViewModel.create(token: session.token, title: trimmedTitle, members: Array(selectedUsernames))
            if groupViewModel.createdGroup != nil { dismiss() }
        }
    }
}

// MARK: – Create Channel View

struct CreateChannelView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    private let container: AppContainer

    @State private var title = ""
    @State private var description = ""
    @State private var allowComments = true
    @StateObject private var viewModel: GroupViewModel

    init(container: AppContainer) {
        self.container = container
        _viewModel = StateObject(
            wrappedValue: GroupViewModel(repository: container.chatRepository, apiClient: container.apiClient)
        )
    }

    var body: some View {
        Form {
            Section {
                TextField(L10n.t("channel_title"), text: $title)
                    .textInputAutocapitalization(.sentences)
                TextField(L10n.t("description"), text: $description, axis: .vertical)
                    .lineLimit(2...5)
            }

            Section {
                Toggle(L10n.t("allow_comments"), isOn: $allowComments)
            }

            if let error = viewModel.lastError {
                Section {
                    Text(error)
                        .font(VostokTypography.caption)
                        .foregroundStyle(VostokColors.danger)
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if viewModel.isLoading {
                    ProgressView()
                } else {
                    Button(L10n.t("create_channel")) { createChannel() }
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .fontWeight(.semibold)
                }
            }
        }
        .vostokNavBar(title: L10n.t("create_channel"), large: false)
    }

    private func createChannel() {
        guard case let .authenticated(session) = appState.sessionState else { return }
        let desc = description.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            await viewModel.createChannel(
                token: session.token,
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                description: desc.isEmpty ? nil : desc,
                allowComments: allowComments
            )
            if viewModel.createdGroup != nil { dismiss() }
        }
    }
}

// MARK: – Group Info View (with permissions, invite links, leave/delete)

struct GroupInfoView: View {
    let chat: ChatDTO
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: GroupViewModel
    @State private var showingLeaveConfirm = false
    @State private var showingDeleteConfirm = false

    init(chat: ChatDTO, container: AppContainer) {
        self.chat = chat
        _viewModel = StateObject(
            wrappedValue: GroupViewModel(repository: container.chatRepository, apiClient: container.apiClient)
        )
    }

    var body: some View {
        List {
            // Header
            Section {
                VStack(spacing: VostokTheme.spaceSM) {
                    VostokAvatar(title: chat.title, size: 72)
                    Text(chat.title)
                        .font(VostokTypography.heading)
                    if let desc = chat.description, !desc.isEmpty {
                        Text(desc)
                            .font(VostokTypography.caption)
                            .foregroundStyle(VostokColors.labelSecondary)
                            .multilineTextAlignment(.center)
                    }
                    if let count = chat.memberCount {
                        Text(L10n.t("n_members", count))
                            .font(VostokTypography.small)
                            .foregroundStyle(VostokColors.labelTertiary)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, VostokTheme.spaceSM)
            }

            // Permissions (admin only)
            if chat.isAdmin {
                Section(L10n.t("chat_settings")) {
                    permissionRow(key: "send_messages", label: L10n.t("who_can_send"))
                    permissionRow(key: "add_members", label: L10n.t("who_can_add_members"))
                    permissionRow(key: "edit_info", label: L10n.t("who_can_edit_info"))
                    permissionRow(key: "pin_messages", label: L10n.t("who_can_pin_messages"))
                }
            }

            // Invite Links (admin only)
            if chat.isAdmin {
                Section(L10n.t("invite_links")) {
                    NavigationLink {
                        InviteLinksView(chatID: chat.id, viewModel: viewModel)
                    } label: {
                        HStack {
                            Image(systemName: "link")
                                .foregroundStyle(VostokColors.accent)
                            Text(L10n.t("invite_links"))
                        }
                    }
                }
            }

            // Members
            Section(L10n.t("members")) {
                ForEach(viewModel.members, id: \.userID) { member in
                    memberRow(member)
                }
            }

            // Actions
            Section {
                if chat.canLeaveChat ?? true {
                    Button(L10n.t("leave_group"), role: .destructive) {
                        showingLeaveConfirm = true
                    }
                }
                if chat.canDeleteChat ?? false {
                    Button(L10n.t("delete_chat"), role: .destructive) {
                        showingDeleteConfirm = true
                    }
                }
            }

            if let error = viewModel.lastError {
                Section {
                    Text(error)
                        .font(VostokTypography.caption)
                        .foregroundStyle(VostokColors.danger)
                }
            }
        }
        .vostokNavBar(title: chat.isChannel ? L10n.t("channels") : L10n.t("view_group_info"), large: false)
        .task {
            guard case let .authenticated(session) = appState.sessionState else { return }
            await viewModel.loadMembers(token: session.token, chatID: chat.id)
        }
        .confirmationDialog(L10n.t("leave_group"), isPresented: $showingLeaveConfirm) {
            Button(L10n.t("leave_group"), role: .destructive) {
                guard case let .authenticated(session) = appState.sessionState else { return }
                Task {
                    await viewModel.leave(token: session.token, chatID: chat.id)
                    dismiss()
                }
            }
        }
        .confirmationDialog(L10n.t("delete_chat"), isPresented: $showingDeleteConfirm) {
            Button(L10n.t("delete_chat"), role: .destructive) {
                guard case let .authenticated(session) = appState.sessionState else { return }
                Task {
                    await viewModel.deleteChat(token: session.token, chatID: chat.id)
                    dismiss()
                }
            }
        }
    }

    private func memberRow(_ member: GroupMemberDTO) -> some View {
        HStack {
            VostokAvatar(title: member.username, size: VostokTheme.avatarCompact)
            VStack(alignment: .leading, spacing: 2) {
                Text(member.username)
                    .font(VostokTypography.bodyBold)
                Text(roleLabel(member.role))
                    .font(VostokTypography.small)
                    .foregroundStyle(VostokColors.labelSecondary)
            }
            Spacer()
            if chat.isAdmin && member.role != "owner" {
                Menu {
                    if member.role != "admin" {
                        Button(L10n.t("make_admin")) { setRole(member, "admin") }
                    }
                    if member.role != "member" {
                        Button(L10n.t("make_member")) { setRole(member, "member") }
                    }
                    if chat.isOwner {
                        Button(L10n.t("transfer_ownership")) { transferOwnership(to: member) }
                    }
                    Divider()
                    Button(L10n.t("remove_member"), role: .destructive) { removeMember(member) }
                } label: {
                    Image(systemName: "ellipsis")
                        .foregroundStyle(VostokColors.labelSecondary)
                        .frame(width: 32, height: 32)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func roleLabel(_ role: String) -> String {
        switch role {
        case "owner": return L10n.t("owner")
        case "admin": return L10n.t("admin")
        default: return L10n.t("member")
        }
    }

    private func permissionRow(key: String, label: String) -> some View {
        let current = chat.permissions?[key] ?? "everyone"
        return HStack {
            Text(label)
                .font(VostokTypography.body)
            Spacer()
            Text(current == "admins" ? L10n.t("permission_admins") : L10n.t("permission_everyone"))
                .font(VostokTypography.caption)
                .foregroundStyle(VostokColors.labelSecondary)
        }
    }

    private func setRole(_ member: GroupMemberDTO, _ role: String) {
        guard case let .authenticated(session) = appState.sessionState else { return }
        Task { await viewModel.setRole(token: session.token, chatID: chat.id, userID: member.userID, role: role) }
    }

    private func removeMember(_ member: GroupMemberDTO) {
        guard case let .authenticated(session) = appState.sessionState else { return }
        Task { await viewModel.remove(token: session.token, chatID: chat.id, userID: member.userID) }
    }

    private func transferOwnership(to member: GroupMemberDTO) {
        guard case let .authenticated(session) = appState.sessionState else { return }
        Task { await viewModel.transferOwnership(token: session.token, chatID: chat.id, newOwnerUserID: member.userID) }
    }
}

// MARK: – Invite Links View

struct InviteLinksView: View {
    let chatID: String
    @ObservedObject var viewModel: GroupViewModel
    @EnvironmentObject private var appState: AppState
    @State private var copiedLinkID: String?

    var body: some View {
        List {
            Section {
                Button {
                    guard case let .authenticated(session) = appState.sessionState else { return }
                    Task { await viewModel.createInviteLink(token: session.token, chatID: chatID) }
                } label: {
                    Label(L10n.t("copy_invite_link"), systemImage: "plus.circle")
                }
            }

            if viewModel.inviteLinks.isEmpty {
                Section {
                    Text(L10n.t("no_invite_links"))
                        .font(VostokTypography.caption)
                        .foregroundStyle(VostokColors.labelSecondary)
                }
            } else {
                Section {
                    ForEach(viewModel.inviteLinks) { link in
                        VStack(alignment: .leading, spacing: VostokTheme.spaceXS) {
                            HStack {
                                Text(link.code)
                                    .font(VostokTypography.bodyBold)
                                    .monospaced()
                                Spacer()
                                Button {
                                    UIPasteboard.general.string = link.code
                                    copiedLinkID = link.id
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copiedLinkID = nil }
                                } label: {
                                    Image(systemName: copiedLinkID == link.id ? "checkmark" : "doc.on.doc")
                                        .foregroundStyle(VostokColors.accent)
                                }
                            }
                            HStack {
                                Text(L10n.t("invite_link_uses", link.uses))
                                    .font(VostokTypography.small)
                                    .foregroundStyle(VostokColors.labelSecondary)
                                Spacer()
                                Button(L10n.t("revoke_invite_link"), role: .destructive) {
                                    guard case let .authenticated(session) = appState.sessionState else { return }
                                    Task { await viewModel.revokeInviteLink(token: session.token, chatID: chatID, linkID: link.id) }
                                }
                                .font(VostokTypography.small)
                            }
                        }
                        .padding(.vertical, VostokTheme.spaceXS)
                    }
                }
            }
        }
        .vostokNavBar(title: L10n.t("invite_links"), large: false)
        .task {
            guard case let .authenticated(session) = appState.sessionState else { return }
            await viewModel.loadInviteLinks(token: session.token, chatID: chatID)
        }
    }
}
