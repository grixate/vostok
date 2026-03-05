import SwiftUI

struct VostokNavBarModifier: ViewModifier {
    let title: String
    let large: Bool

    func body(content: Content) -> some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(large ? .large : .inline)
    }
}

extension View {
    func vostokNavBar(title: String, large: Bool = true) -> some View {
        modifier(VostokNavBarModifier(title: title, large: large))
    }
}
