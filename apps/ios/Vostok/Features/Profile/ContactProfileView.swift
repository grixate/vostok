import SwiftUI

struct ContactProfileView: View {
    let chat: ChatDTO
    let container: AppContainer

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Avatar + identity
                VStack(spacing: 8) {
                    VostokAvatar(title: chat.title, size: 80, isOnline: false)
                        .padding(.bottom, 4)

                    Text(chat.title)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(VostokColors.labelPrimary)
                        .multilineTextAlignment(.center)

                    Text("@\(chat.title)")
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(VostokColors.labelSecondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 32)
                .padding(.bottom, 28)

                Divider()
                    .padding(.horizontal, 16)

                // Action row
                HStack(spacing: 40) {
                    profileAction(icon: "message.fill", label: "Message") {
                        dismiss()
                    }

                    NavigationLink {
                        CallView(chatID: chat.id, container: container)
                    } label: {
                        profileActionLabel(icon: "phone.fill", label: "Audio Call")
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 28)
                .padding(.horizontal, 32)

                Divider()
                    .padding(.horizontal, 16)
                    .padding(.top, 28)

                // Shared media grid
                ProfileMediaSection(items: [])
                    .padding(.top, 8)
            }
        }
        .vostokNavBar(title: "", large: false)
    }

    private func profileAction(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            profileActionLabel(icon: icon, label: label)
        }
        .buttonStyle(.plain)
    }

    private func profileActionLabel(icon: String, label: String) -> some View {
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .fill(VostokColors.accent.opacity(0.12))
                    .frame(width: 56, height: 56)
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(VostokColors.accent)
            }
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(VostokColors.labelSecondary)
        }
    }
}
