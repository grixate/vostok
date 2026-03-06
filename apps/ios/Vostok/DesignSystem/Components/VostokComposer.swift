import SwiftUI

struct VostokComposer: View {
    @Binding var text: String
    var replyTitle: String? = nil
    var replyText: String? = nil
    var onCancelReply: (() -> Void)? = nil
    var onAttach: () -> Void
    var onSend: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            Button(action: onAttach) {
                Image(systemName: "paperclip")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(VostokColors.controlPrimary)
            }
            .frame(width: 44, height: 44)
            .background(glassCircleBackground)
            .clipShape(Circle())
            .accessibilityLabel("Attach")
            .accessibilityHint("Add photo, video, file, or voice message")

            VStack(spacing: 0) {
                if let replyTitle, let replyText {
                    replyPreview(title: replyTitle, text: replyText)
                }

                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Message", text: $text, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.system(size: 17, weight: .regular))
                        .lineLimit(1...8)
                        .submitLabel(.send)
                        .onSubmit {
                            if isSendMode {
                                onSend()
                            }
                        }
                        .focused($isFocused)
                        .accessibilityLabel("Message")
                        .accessibilityHint("Type your message")

                    HStack(spacing: 8) {
                        Image(systemName: isSendMode ? "face.smiling" : "moon")
                            .font(.system(size: 18, weight: .regular))
                            .foregroundStyle(VostokColors.controlSecondary)
                            .accessibilityHidden(true)

                        if isSendMode {
                            Button(action: onSend) {
                                Image(systemName: "paperplane.fill")
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundStyle(.black.opacity(0.95))
                                    .frame(width: 44, height: 44)
                                    .background(VostokColors.accent, in: Circle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Send message")
                            .accessibilityHint("Sends the typed message")
                        }
                    }
                }
                .padding(.leading, 9)
                .padding(.trailing, 8)
                .padding(.top, 6)
                .padding(.bottom, 6)
            }
            .frame(minHeight: 44)
            .background(glassFieldBackground)
            .clipShape(RoundedRectangle(cornerRadius: 21, style: .continuous))

            if !isSendMode {
                Button(action: onSend) {
                    Image(systemName: "mic")
                        .font(.system(size: 20, weight: .regular))
                        .foregroundStyle(VostokColors.controlPrimary)
                }
                .frame(width: 44, height: 44)
                .background(glassCircleBackground)
                .clipShape(Circle())
                .accessibilityLabel("Record voice message")
                .accessibilityHint("Starts or stops recording")
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 4)
        .padding(.bottom, 12)
        .background(
            LinearGradient(
                colors: [.clear, VostokColors.secondaryBackground.opacity(0.18)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private var isSendMode: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || replyTitle != nil || isFocused
    }

    private var glassFieldBackground: some View {
        RoundedRectangle(cornerRadius: 21, style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 21, style: .continuous)
                    .fill(VostokColors.glassLight.opacity(0.7))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 21, style: .continuous)
                    .strokeBorder(VostokColors.separatorVibrant.opacity(0.45), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.08), radius: 16, y: 4)
    }

    private var glassCircleBackground: some View {
        Circle()
            .fill(.ultraThinMaterial)
            .overlay(Circle().fill(VostokColors.glassLight.opacity(0.7)))
            .overlay(Circle().strokeBorder(VostokColors.separatorVibrant.opacity(0.45), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.08), radius: 16, y: 4)
    }

    private func replyPreview(title: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Rectangle()
                .fill(VostokColors.accent)
                .frame(width: 2, height: 34)
                .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))

            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(VostokColors.accent)
                    .lineLimit(1)
                Text(text)
                    .font(.system(size: 17, weight: .regular))
                    .foregroundStyle(VostokColors.labelPrimary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if let onCancelReply {
                Button(action: onCancelReply) {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .regular))
                        .foregroundStyle(VostokColors.labelSecondary)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel reply")
            }
        }
        .padding(.leading, 9)
        .padding(.trailing, 6)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }
}
