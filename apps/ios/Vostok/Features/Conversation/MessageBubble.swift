import SwiftUI

struct MessageBubble: View {
    let message: MessageDTO
    let incoming: Bool

    var body: some View {
        VostokMessageBubble(
            text: message.ciphertext ?? "",
            timestamp: message.insertedAt,
            incoming: incoming
        )
    }
}
