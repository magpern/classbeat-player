import XCTest
import Security
@testable import App

// The first launch after an install (issue #896): with no marker, every Keychain item is deleted
// before anything reads the Keychain, the marker is written, and the app starts unpaired in rider
// mode. A token an earlier install left behind never pairs this one.
final class FirstLaunchTests: XCTestCase {
    private var suite = ""
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suite = "classbeat.test." + UUID().uuidString
        defaults = UserDefaults(suiteName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        defaults = nil
        super.tearDown()
    }

    private func storedToken(_ keychain: FakeKeychain) {
        let text = PairingRecord(origin: FakeBackend.origin, token: Secrets.token(), email: nil).text()!
        keychain.items = [KeychainSecretStore.account: Data(text.utf8)]
    }

    func testAStoredTokenWithNoMarkerIsGoneAfterLaunch() {
        let keychain = FakeKeychain()
        storedToken(keychain)
        let store = FirstLaunch.store(defaults: defaults, keychain: keychain)
        XCTAssertTrue(keychain.items.isEmpty)
        XCTAssertNil(store.load())
        XCTAssertTrue(defaults.bool(forKey: FirstLaunch.markerKey))
    }

    func testTheWipeRunsBeforeAnythingReadsTheKeychain() {
        let keychain = FakeKeychain()
        storedToken(keychain)
        let rig = PairingRig(store: FirstLaunch.store(defaults: defaults, keychain: keychain))
        rig.service.load()
        XCTAssertEqual(Array(keychain.log.prefix(5)), Array(repeating: "delete", count: 5))
        XCTAssertEqual(keychain.log.firstIndex(of: "copy"), 5)
        XCTAssertFalse(rig.service.paired)
        XCTAssertEqual(rig.backend.requests.count, 0)
    }

    func testTheAppStartsUnpairedInRiderMode() {
        let keychain = FakeKeychain()
        storedToken(keychain)
        let rig = PairingRig(store: FirstLaunch.store(defaults: defaults, keychain: keychain))
        rig.service.load()
        XCTAssertEqual(ModePolicy.startMode(Mode.instructor.stored, paired: rig.service.paired, secureLock: true), .rider)
    }

    func testWithTheMarkerNothingIsWiped() {
        defaults.set(true, forKey: FirstLaunch.markerKey)
        let keychain = FakeKeychain()
        storedToken(keychain)
        let store = FirstLaunch.store(defaults: defaults, keychain: keychain)
        XCTAssertFalse(keychain.log.contains("delete"))
        XCTAssertNotNil(store.load())
    }

    func testAWipeThatFailsLeavesNoMarkerAndAStoreThatNeverPairs() {
        let keychain = FakeKeychain()
        storedToken(keychain)
        keychain.deleteStatus = errSecInteractionNotAllowed
        let store = FirstLaunch.store(defaults: defaults, keychain: keychain)
        XCTAssertTrue(store is ClosedSecretStore)
        XCTAssertFalse(defaults.bool(forKey: FirstLaunch.markerKey))
        XCTAssertFalse(store.available())
        XCTAssertNil(store.load())
        XCTAssertFalse(keychain.log.contains("copy"))
    }
}
