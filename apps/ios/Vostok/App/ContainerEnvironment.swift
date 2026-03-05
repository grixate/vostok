import SwiftUI

private struct VostokContainerKey: EnvironmentKey {
    static let defaultValue: AppContainer = AppContainer(environment: .load())
}

extension EnvironmentValues {
    var vostokContainer: AppContainer {
        get { self[VostokContainerKey.self] }
        set { self[VostokContainerKey.self] = newValue }
    }
}
