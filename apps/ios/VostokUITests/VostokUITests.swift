import XCTest

final class VostokUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLaunch() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
    }

    // MARK: - Design Review Screenshots

    func testNavigateToRegistration() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))

        let createBtn = app.buttons["Create Account"]
        XCTAssertTrue(createBtn.waitForExistence(timeout: 10), "Create Account button not found")
        saveScreen("01-landing")

        createBtn.tap()
        Thread.sleep(forTimeInterval: 1.5)
        saveScreen("02-registration")
    }

    func testNavigateToLogin() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))

        let loginBtn = app.buttons["Login"]
        XCTAssertTrue(loginBtn.waitForExistence(timeout: 10), "Login button not found")
        loginBtn.tap()
        Thread.sleep(forTimeInterval: 1.5)
        saveScreen("03-login")
    }

    // MARK: - Registration Flow (reaches main tab UI)

    func testRegisterAndViewChatList() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))

        // Tap Create Account
        let createBtn = app.buttons["Create Account"]
        XCTAssertTrue(createBtn.waitForExistence(timeout: 10))
        createBtn.tap()
        Thread.sleep(forTimeInterval: 1.0)

        // Type username into the text field
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("uitestuser")

        // Dismiss keyboard and submit
        app.buttons.matching(identifier: "Create Account").lastMatch.tap()

        // Wait for main tab UI to appear (up to 15s for network + key gen)
        let chatTab = app.tabBars.firstMatch
        let appeared = chatTab.waitForExistence(timeout: 15)

        saveScreen("04-post-registration")

        if appeared {
            // Give the chat list a moment to load
            Thread.sleep(forTimeInterval: 2.0)
            saveScreen("05-chat-list")

            // Tap Contacts tab if present
            let contactsTab = app.tabBars.buttons.element(boundBy: 1)
            if contactsTab.exists {
                contactsTab.tap()
                Thread.sleep(forTimeInterval: 1.5)
                saveScreen("06-contacts")
            }

            // Tap Profile tab if present
            let lastTab = app.tabBars.buttons.element(boundBy: app.tabBars.buttons.count - 1)
            if lastTab.exists {
                lastTab.tap()
                Thread.sleep(forTimeInterval: 1.5)
                saveScreen("07-profile")
            }
        }
    }

    // MARK: - Helpers

    private func saveScreen(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        try? screenshot.pngRepresentation.write(
            to: URL(fileURLWithPath: "/tmp/vostok-\(name).png"))
    }
}

private extension XCUIElementQuery {
    var lastMatch: XCUIElement { element(boundBy: count - 1) }
}
