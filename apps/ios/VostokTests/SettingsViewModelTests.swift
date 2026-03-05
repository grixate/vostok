import XCTest
@testable import Vostok

final class SettingsViewModelTests: XCTestCase {
    @MainActor
    func testSettingsPersistAcrossViewModelInstances() {
        let suiteName = "SettingsViewModelTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)

        do {
            let first = SettingsViewModel(userDefaults: defaults)
            first.appearance = .dark
            first.readReceipts = false
            first.appLockEnabled = true
        }

        let second = SettingsViewModel(userDefaults: defaults)
        XCTAssertEqual(second.appearance, .dark)
        XCTAssertEqual(second.readReceipts, false)
        XCTAssertEqual(second.appLockEnabled, true)

        defaults.removePersistentDomain(forName: suiteName)
    }
}
