import XCTest
@testable import App

// The mode is kept in the app's own defaults (issue #895), under its two keys, and read back.
final class DefaultsModeStoreTests: XCTestCase {
    private let suite = "classbeat.tests.modeStore"
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suite)
        defaults.removePersistentDomain(forName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        super.tearDown()
    }

    func testAFreshStoreHoldsNoModeAndNoWipe() {
        let store = DefaultsModeStore(defaults)
        XCTAssertNil(store.read())
        XCTAssertFalse(store.wipePending())
    }

    func testTheModeAndTheWipeFlagAreWrittenAndReadBack() throws {
        let store = DefaultsModeStore(defaults)
        try store.write(Mode.instructor.stored)
        try store.setWipePending(true)
        XCTAssertEqual(defaults.string(forKey: DefaultsModeStore.modeKey), Mode.instructor.stored)
        let again = DefaultsModeStore(defaults)
        XCTAssertEqual(again.read(), Mode.instructor.stored)
        XCTAssertTrue(again.wipePending())
        try again.setWipePending(false)
        try again.write(Mode.rider.stored)
        XCTAssertEqual(store.read(), Mode.rider.stored)
        XCTAssertFalse(store.wipePending())
    }

    func testTheKeysAreTheAppsOwn() {
        XCTAssertEqual(DefaultsModeStore.modeKey, "classbeat.mode")
        XCTAssertEqual(DefaultsModeStore.wipeKey, "classbeat.modeWipePending")
    }
}
