import XCTest
@testable import App

// The native pairing screen's logic (issue #925) on a real pairing service and the fakes: no network,
// no Keychain, the clock and the one-second tick by hand.
final class PairingUiTests: XCTestCase {
    private var rig: PairingRig!
    private var screens: FakePairingScreens!
    private var ticker: FakeTicker!
    private var ui: PairingUi!
    private var left: [Bool] = []

    override func setUp() {
        super.setUp()
        rig = PairingRig()
        screens = FakePairingScreens()
        ticker = FakeTicker()
        ui = rig.ui(screens, ticker)
        left = []
    }

    private func open(instructor: Bool = false) {
        ui.open(instructor: instructor) { [unowned self] made in self.left.append(made) }
    }

    func testOpeningAsksForACodeAndShowsIt() {
        open()
        XCTAssertTrue(ui.showing)
        XCTAssertEqual(rig.backend.requests.map(\.description), ["POST /api/pairing/start"])
        XCTAssertTrue(screens.words.contains("○  Asking the server for a code"))
        rig.backend.ok(FakeBackend.startBody())
        XCTAssertTrue(screens.words.contains("BCDF-GHJK"))
        XCTAssertTrue(screens.words.contains("The code runs out in 10:00"))
        XCTAssertTrue(ticker.running)
    }

    func testTheCountdownChangesInPlace() {
        open()
        rig.backend.ok(FakeBackend.startBody())
        let shows = screens.shows
        rig.ports.time += 1_000
        ticker.tick?()
        XCTAssertEqual(screens.shows, shows, "the focus stays where it is")
        XCTAssertGreaterThan(screens.retexts, 0)
        XCTAssertTrue(screens.words.contains("The code runs out in 9:59"))
    }

    func testOpenTheSiteGoesToSafari() {
        open()
        rig.backend.ok(FakeBackend.startBody())
        // The code shows first, to compare or to type on another device: nothing opens by itself.
        XCTAssertEqual(rig.ports.pages, [])
        screens.press("Open the site")
        XCTAssertEqual(rig.ports.pages, [FakeBackend.origin + "/pair"])
        // Through the ports (Safari), never the app's web view, and never carrying the codes.
        XCTAssertFalse(rig.ports.pages[0].contains("BCDF"))
        XCTAssertFalse(rig.ports.pages[0].contains(Secrets.deviceCode()))
        XCTAssertTrue(ui.showing)
    }

    /// Back from Safari: the waiting line, and the server is asked at once, not at the next wake.
    func testBackFromSafariAsksTheServerAtOnce() {
        open()
        rig.backend.ok(FakeBackend.startBody())
        rig.ports.fireNext()
        rig.backend.answerNext(.http(status: 400, body: ["error": PairingProtocol.pending], retryAfterS: nil))
        ui.stopped()
        let asked = rig.backend.requests.count
        rig.ports.timers.forEach { $0.run() }
        XCTAssertEqual(rig.backend.requests.count, asked, "nothing is asked in the background")
        ui.resumed()
        XCTAssertEqual(rig.backend.requests.count, asked + 1)
        XCTAssertTrue(screens.words.contains("○  Not yet confirmed on the website"))
        XCTAssertTrue(screens.words.contains("Open the page again"))
        rig.backend.ok(FakeBackend.tokenBody())
        XCTAssertEqual(screens.current?.keys.map { $0.label }, ["Continue"])
        XCTAssertFalse(ticker.running)
        screens.press("Continue")
        XCTAssertEqual(left, [true])
        XCTAssertFalse(ui.showing)
        XCTAssertNil(screens.current)
    }

    func testCancelAndTheEdgeSwipeStopTheAttempt() {
        open()
        rig.backend.ok(FakeBackend.startBody())
        screens.press("Cancel")
        XCTAssertEqual(left, [false])
        XCTAssertEqual(rig.service.view(), .unpaired(notice: nil))
        XCTAssertFalse(ticker.running)
        open()
        rig.backend.ok(FakeBackend.startBody())
        screens.swipe()
        XCTAssertEqual(left, [false, false])
        XCTAssertFalse(rig.service.paired)
    }

    /// No passcode: the Keychain refuses, nothing is asked of the server, and "Start again" checks
    /// again, so a passcode set meanwhile lets the pairing begin.
    func testNoPasscodeMeansNoPairingAndStartAgainChecksAgain() {
        rig.store.isAvailable = false
        open()
        XCTAssertEqual(rig.backend.requests.count, 0)
        XCTAssertTrue(screens.words.contains("This phone cannot be paired.\nPairing needs a passcode to keep it safe. Set one in Settings, then start again. Rider mode works without it."))
        screens.press("Start again")
        XCTAssertEqual(rig.backend.requests.count, 0, "still no passcode")
        XCTAssertEqual(rig.service.view(), .unpaired(notice: .noKeychain))
        rig.store.isAvailable = true
        screens.press("Start again")
        XCTAssertEqual(rig.backend.requests.map(\.description), ["POST /api/pairing/start"])
        rig.backend.ok(FakeBackend.startBody())
        XCTAssertTrue(screens.words.contains("BCDF-GHJK"))
    }

    func testRiderModeOnAPlateLeavesWithoutAPairing() {
        rig.store.isAvailable = false
        open()
        screens.press("Rider mode")
        XCTAssertEqual(left, [false])
        XCTAssertFalse(ui.showing)
    }

    func testANoticeIsHeldUntilStartAgain() {
        open()
        rig.backend.ok(FakeBackend.startBody())
        rig.ports.fireNext()
        rig.backend.answerNext(.http(status: 400, body: ["error": PairingProtocol.denied], retryAfterS: nil))
        XCTAssertTrue(screens.words.contains("Refused on the website.\nNothing was kept on this phone."))
        XCTAssertFalse(ticker.running)
        let asked = rig.backend.requests.count
        screens.press("Start again")
        XCTAssertEqual(rig.backend.requests.count, asked + 1)
    }

    func testDropClosesWithNoAnswer() {
        open()
        rig.backend.ok(FakeBackend.startBody())
        ui.drop()
        XCTAssertTrue(left.isEmpty)
        XCTAssertFalse(ui.showing)
        XCTAssertNil(screens.current)
        XCTAssertFalse(ticker.running)
        XCTAssertFalse(rig.service.paired)
    }

    func testNoScreenEverShowsTheTokenOrTheDeviceCode() {
        open()
        rig.backend.ok(FakeBackend.startBody())
        rig.ports.fireNext()
        ui.stopped()
        ui.resumed()
        rig.backend.ok(FakeBackend.tokenBody())
        XCTAssertFalse(screens.everyWord.isEmpty)
        for word in screens.everyWord {
            XCTAssertFalse(word.contains(Secrets.token()))
            XCTAssertFalse(word.contains(Secrets.deviceCode()))
        }
    }

    func testAPressAfterTheScreenWentDoesNothing() {
        open()
        rig.backend.ok(FakeBackend.startBody())
        ui.back()
        XCTAssertEqual(left, [false])
        ui.changed()
        XCTAssertEqual(left, [false])
        XCTAssertNil(screens.current)
    }
}
