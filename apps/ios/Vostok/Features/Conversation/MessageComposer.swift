import SwiftUI

struct MessageComposer: View {
    @Binding var text: String
    var onAttach: () -> Void
    var onSend: () -> Void
    @State private var isVideoMode = false

    var body: some View {
        VostokComposer(text: $text, isVideoMode: $isVideoMode, onAttach: onAttach, onSend: onSend)
    }
}
