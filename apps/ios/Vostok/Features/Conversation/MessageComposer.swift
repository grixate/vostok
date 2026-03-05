import SwiftUI

struct MessageComposer: View {
    @Binding var text: String
    var onAttach: () -> Void
    var onSend: () -> Void

    var body: some View {
        VostokComposer(text: $text, onAttach: onAttach, onSend: onSend)
    }
}
