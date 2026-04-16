import SwiftUI

struct VostokComposer: View {
    @Binding var text: String
    @Binding var isVideoMode: Bool
    var replyTitle: String? = nil
    var replyText: String? = nil
    var onCancelReply: (() -> Void)? = nil
    var onAttach: () -> Void
    var onSend: () -> Void
    var onStartRecording: () -> Void = {}
    var onEndRecording: () -> Void = {}
    var onDragChanged: (CGSize) -> Void = { _ in }

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            Button(action: onAttach) {
                Image(systemName: "paperclip")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(VostokColors.labelSecondary)
            }
            .frame(width: 44, height: 44)
            .background(VostokColors.tertiaryBackground)
            .clipShape(Circle())
            .accessibilityLabel("Attach")
            .accessibilityHint("Add photo, video, file, or voice message")

            VStack(spacing: 0) {
                if let replyTitle, let replyText {
                    replyPreview(title: replyTitle, text: replyText)
                }

                HStack(alignment: .center, spacing: VostokTheme.spaceSM) {
                    TextField("Message", text: $text, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(VostokTypography.body)
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

                    if isSendMode {
                        Button(action: onSend) {
                            Image(systemName: "paperplane.fill")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(VostokColors.textOnAccent)
                                .frame(width: 44, height: 44)
                                .background(VostokColors.accent, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Send message")
                        .accessibilityHint("Sends the typed message")
                    }
                }
                .padding(.leading, 9)
                .padding(.trailing, VostokTheme.spaceSM)
                .padding(.top, 6)
                .padding(.bottom, 6)
            }
            .frame(minHeight: 44)
            .background(VostokColors.fillInput)
            .clipShape(RoundedRectangle(cornerRadius: 21, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 21, style: .continuous)
                    .strokeBorder(VostokColors.separator, lineWidth: 0.5)
            )

            if !isSendMode {
                VoiceRecordButton(
                    isVideoMode: $isVideoMode,
                    onStartRecording: onStartRecording,
                    onEndRecording: onEndRecording,
                    onDragChanged: onDragChanged
                )
            }
        }
        .padding(.horizontal, VostokTheme.spaceSM)
        .padding(.top, VostokTheme.spaceXS)
        .padding(.bottom, VostokTheme.spaceMD)
        .background(VostokColors.secondaryBackground)
    }

    private var isSendMode: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || replyTitle != nil
    }

    private func replyPreview(title: String, text: String) -> some View {
        HStack(alignment: .top, spacing: VostokTheme.spaceSM) {
            Rectangle()
                .fill(VostokColors.accent)
                .frame(width: 2, height: 34)
                .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))

            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .font(VostokTypography.title)
                    .foregroundStyle(VostokColors.accent)
                    .lineLimit(1)
                Text(text)
                    .font(VostokTypography.body)
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
        .padding(.top, VostokTheme.spaceSM)
        .padding(.bottom, VostokTheme.spaceXS)
    }
}
