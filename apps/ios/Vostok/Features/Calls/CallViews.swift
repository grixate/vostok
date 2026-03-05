import SwiftUI

struct CallView: View {
    @EnvironmentObject private var appState: AppState

    let chatID: String
    @StateObject private var viewModel: CallViewModel
    @State private var mode = "voice"
    @State private var isAdvancedExpanded = false

    init(chatID: String, container: AppContainer) {
        self.chatID = chatID
        _viewModel = StateObject(wrappedValue: CallViewModel(repository: container.callRepository))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                heroCard
                controlsCard
                if let call = viewModel.activeCall {
                    callDetailsCard(call)
                }
                advancedPanel
                if let error = viewModel.lastError {
                    errorCard(error)
                }
            }
            .padding(16)
        }
        .background(backgroundGradient.ignoresSafeArea())
        .vostokNavBar(title: "Call", large: false)
        .onDisappear {
            viewModel.stopPolling()
        }
        .task {
            withSession { token in
                Task { await viewModel.refreshActive(token: token, chatID: chatID) }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .vostokCallEvent)) { notification in
            guard let event = RealtimeCallEvent(notification: notification),
                  event.chatID == chatID
            else {
                return
            }

            withSession { token in
                Task { await viewModel.refreshActive(token: token, chatID: chatID) }
            }
        }
    }

    private var heroCard: some View {
        VStack(spacing: 12) {
            VostokAvatar(title: "C", size: 84, isOnline: viewModel.activeCall != nil)
            Text(viewModel.statusTitle)
                .font(VostokTypography.title)
                .foregroundStyle(VostokColors.labelPrimary)
            Text(viewModel.statusSubtitle)
                .font(VostokTypography.footnote)
                .foregroundStyle(VostokColors.labelSecondary)
                .multilineTextAlignment(.center)
                .textSelection(.enabled)

            HStack(spacing: 8) {
                statusBadge(viewModel.isPolling ? "Polling" : "Idle", accent: viewModel.isPolling ? VostokColors.online : VostokColors.controlSecondary)
                statusBadge(mode.capitalized, accent: VostokColors.accent)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .background(cardBackground)
    }

    private var controlsCard: some View {
        VStack(spacing: 14) {
            Picker("Mode", selection: $mode) {
                Text("Voice").tag("voice")
                Text("Video").tag("video")
            }
            .pickerStyle(.segmented)

            HStack(spacing: 10) {
                quickToggle(
                    title: "Mute",
                    systemImage: viewModel.isMuted ? "mic.slash.fill" : "mic.fill",
                    isActive: viewModel.isMuted
                ) {
                    viewModel.isMuted.toggle()
                }
                quickToggle(
                    title: "Speaker",
                    systemImage: viewModel.isSpeakerEnabled ? "speaker.wave.3.fill" : "speaker.slash.fill",
                    isActive: viewModel.isSpeakerEnabled
                ) {
                    viewModel.isSpeakerEnabled.toggle()
                }
                quickToggle(
                    title: "Video",
                    systemImage: viewModel.isVideoEnabled ? "video.fill" : "video.slash.fill",
                    isActive: viewModel.isVideoEnabled
                ) {
                    viewModel.isVideoEnabled.toggle()
                }
            }

            HStack(spacing: 8) {
                Button("Refresh") {
                    withSession { token in
                        Task { await viewModel.refreshActive(token: token, chatID: chatID) }
                    }
                }
                .buttonStyle(VostokSecondaryButtonStyle())

                Button(viewModel.isPolling ? "Stop Polling" : "Poll") {
                    withSession { token in
                        viewModel.togglePolling(token: token)
                    }
                }
                .buttonStyle(VostokSecondaryButtonStyle())
            }

            if viewModel.canStartCall {
                Button("Start \(mode.capitalized) Call") {
                    withSession { token in
                        Task { await viewModel.start(token: token, chatID: chatID, mode: mode) }
                    }
                }
                .buttonStyle(VostokPrimaryButtonStyle())
            }

            HStack(spacing: 8) {
                if viewModel.canJoinCall {
                    Button("Join") {
                        withSession { token in
                            Task { await viewModel.join(token: token, trackKind: mode) }
                        }
                    }
                    .buttonStyle(VostokSecondaryButtonStyle())
                }

                if viewModel.canLeaveCall {
                    Button("Leave") {
                        withSession { token in
                            Task { await viewModel.leave(token: token) }
                        }
                    }
                    .buttonStyle(VostokSecondaryButtonStyle())
                }

                if viewModel.canEndCall {
                    Button("End", role: .destructive) {
                        withSession { token in
                            Task { await viewModel.end(token: token) }
                        }
                    }
                    .buttonStyle(VostokSecondaryButtonStyle())
                }
            }
        }
        .padding(14)
        .background(cardBackground)
    }

    private func callDetailsCard(_ call: CallDTO) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Call Details")
                .font(VostokTypography.bodyEmphasized)
                .foregroundStyle(VostokColors.labelPrimary)
            labeledRow("Call ID", call.id)
            labeledRow("Chat ID", call.chatID)
            labeledRow("Status", call.status)
            labeledRow("Mode", call.mode)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(cardBackground)
    }

    private var advancedPanel: some View {
        DisclosureGroup(
            isExpanded: $isAdvancedExpanded,
            content: {
                VStack(alignment: .leading, spacing: 10) {
                    if let endpoint = viewModel.endpointState {
                        Text("Endpoint: \(endpoint.endpointID)")
                            .font(VostokTypography.footnote)
                            .foregroundStyle(VostokColors.labelPrimary)
                        Text("Pending media events: \(endpoint.pendingMediaEventCount)")
                            .font(VostokTypography.caption)
                            .foregroundStyle(VostokColors.labelSecondary)
                    }

                    TextField("Media event", text: $viewModel.mediaEvent)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 10)
                        .frame(height: 36)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(VostokColors.secondaryBackground)
                        )

                    Button("Send Media Event") {
                        withSession { token in
                            Task { await viewModel.sendMediaEvent(token: token) }
                        }
                    }
                    .buttonStyle(VostokSecondaryButtonStyle())

                    Picker("Signal Type", selection: $viewModel.selectedSignalType) {
                        Text("Offer").tag("offer")
                        Text("Answer").tag("answer")
                        Text("ICE").tag("ice")
                        Text("Renegotiate").tag("renegotiate")
                        Text("Heartbeat").tag("heartbeat")
                    }
                    .pickerStyle(.menu)

                    TextField("Signal payload", text: $viewModel.signalPayload, axis: .vertical)
                        .lineLimit(2...5)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(VostokColors.secondaryBackground)
                        )

                    Button("Send Signal") {
                        withSession { token in
                            Task { await viewModel.sendSignal(token: token) }
                        }
                    }
                    .buttonStyle(VostokSecondaryButtonStyle())

                    Button("Fetch TURN Credentials") {
                        withSession { token in
                            Task { await viewModel.fetchTurnCredentials(token: token) }
                        }
                    }
                    .buttonStyle(VostokSecondaryButtonStyle())

                    if let summary = viewModel.turnCredentialsSummary {
                        Text(summary)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(VostokColors.labelSecondary)
                    }

                    if !viewModel.pendingMediaEvents.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Media Events")
                                .font(VostokTypography.caption)
                                .foregroundStyle(VostokColors.labelSecondary)
                            ForEach(Array(viewModel.pendingMediaEvents.enumerated()), id: \.offset) { _, event in
                                Text(event)
                                    .font(.system(.caption2, design: .monospaced))
                                    .foregroundStyle(VostokColors.labelSecondary)
                            }
                        }
                    }

                    if !viewModel.signals.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Signals")
                                .font(VostokTypography.caption)
                                .foregroundStyle(VostokColors.labelSecondary)
                            ForEach(Array(viewModel.signals.enumerated()), id: \.offset) { _, signal in
                                Text("\(signal.signalType.uppercased()) • \(signal.fromDeviceID)")
                                    .font(.system(.caption2, design: .monospaced))
                                    .foregroundStyle(VostokColors.labelSecondary)
                            }
                        }
                    }
                }
                .padding(.top, 10)
            },
            label: {
                Text("Advanced Signaling")
                    .font(VostokTypography.bodyEmphasized)
                    .foregroundStyle(VostokColors.labelPrimary)
            }
        )
        .padding(14)
        .background(cardBackground)
    }

    private func errorCard(_ error: String) -> some View {
        Text(error)
            .font(VostokTypography.footnote)
            .foregroundStyle(VostokColors.danger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(VostokColors.primaryBackground.opacity(0.9))
            )
    }

    private func statusBadge(_ text: String, accent: Color) -> some View {
        Text(text)
            .font(VostokTypography.caption)
            .foregroundStyle(accent)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(
                Capsule(style: .continuous)
                    .fill(accent.opacity(0.13))
            )
    }

    private func quickToggle(title: String, systemImage: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(isActive ? .white : VostokColors.labelPrimary)
                    .frame(width: 42, height: 42)
                    .background(
                        Circle()
                            .fill(isActive ? VostokColors.accent : VostokColors.secondaryBackground)
                    )
                Text(title)
                    .font(VostokTypography.caption)
                    .foregroundStyle(VostokColors.labelSecondary)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    private func labeledRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(VostokTypography.caption)
                .foregroundStyle(VostokColors.labelSecondary)
            Spacer(minLength: 8)
            Text(value)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(VostokColors.labelPrimary)
                .textSelection(.enabled)
        }
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .fill(VostokColors.primaryBackground.opacity(0.92))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(VostokColors.separatorVibrant.opacity(0.55), lineWidth: 0.8)
            )
            .shadow(color: .black.opacity(0.08), radius: 16, y: 8)
    }

    private var backgroundGradient: LinearGradient {
        LinearGradient(
            colors: [
                VostokColors.secondaryBackground,
                VostokColors.chatWallpaperBase.opacity(0.25),
                VostokColors.primaryBackground
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private func withSession(_ action: (String) -> Void) {
        guard case let .authenticated(session) = appState.sessionState else { return }
        action(session.token)
    }
}

struct IncomingCallView: View {
    var body: some View {
        VStack(spacing: 20) {
            VostokAvatar(title: "C", size: 96, isOnline: true)
            Text("Incoming Call")
                .font(VostokTypography.title)
            HStack(spacing: 24) {
                Image(systemName: "phone.down.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(VostokColors.danger))

                Image(systemName: "phone.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(VostokColors.online))
            }
        }
        .padding(24)
    }
}

struct GroupCallView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Group Call")
                .font(VostokTypography.title)
            Text("Join from a chat to sync participant state and endpoint events.")
                .font(VostokTypography.footnote)
                .foregroundStyle(VostokColors.labelSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
    }
}
