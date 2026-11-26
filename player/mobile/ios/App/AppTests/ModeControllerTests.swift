import XCTest
@testable import App

// The iOS edge of the mode holder (issue #895), with the device owner's authentication faked: every
// entry to instructor mode asks it afresh, a device with no passcode has no instructor mode, a
// failed or cancelled check stays in rider mode, and the page reaches only the current mode's plugin.
final class ModeControllerTests: XCTestCase {
    private final class FakeLock: ScreenLock {
        var isSet = true
        var asks = 0
        var done: ((Bool) -> Void)?

        func ask(_ done: @escaping (Bool) -> Void) {
            asks += 1
            self.done = done
        }

        func answer(_ passed: Bool) {
            let done = self.done
            self.done = nil
            done?(passed)
        }
    }

    private final class FakeScreens: ModeScreens {
        var log: [String] = []
        var stay: (() -> Void)?
        var toRider: (() -> Void)?

        func noLock(stay: @escaping () -> Void) {
            log.append("noLock")
            self.stay = stay
        }

        func riderQuestion(stay: @escaping () -> Void, switch: @escaping () -> Void) {
            log.append("question")
            self.stay = stay
            toRider = `switch`
        }

        func switching(rider: Bool) { log.append(rider ? "switching rider" : "switching instructor") }

        func hide() { log.append("hide") }
    }

    private final class FakeLoader: PageLoader {
        var paths: [String] = []
        func load(_ path: String) { paths.append(path) }
    }

    private final class FakeCall: PageCall {
        var answers: [[String: Any]] = []
        var refusals = 0

        func answer(_ data: [String: Any]) { answers.append(data) }
        func refuse() { refusals += 1 }

        var result: String? { answers.count == 1 && refusals == 0 ? answers[0]["result"] as? String : nil }
        var refusedOnly: Bool { answers.isEmpty && refusals == 1 }
    }

    private final class PairedDevice: Device {
        private let lock: ScreenLock
        var paired = true
        init(lock: ScreenLock) { self.lock = lock }
        var secureLock: Bool { lock.isSet }
    }

    private final class MemoryStore: ModeStore {
        var value: String?
        var wipe = false
        func read() -> String? { value }
        func write(_ value: String) throws { self.value = value }
        func wipePending() -> Bool { wipe }
        func setWipePending(_ pending: Bool) throws { wipe = pending }
    }

    private var lock: FakeLock!
    private var screens: FakeScreens!
    private var loader: FakeLoader!
    private var device: PairedDevice!
    private var store: MemoryStore!
    private var stops: [[String]] = []
    private var tokens: [String] = []
    private var controller: ModeController!

    override func setUp() {
        super.setUp()
        lock = FakeLock()
        screens = FakeScreens()
        loader = FakeLoader()
        device = PairedDevice(lock: lock)
        store = MemoryStore()
        stops = []
        tokens = []
        controller = ModeController(
            lock: lock,
            screens: screens,
            loader: loader,
            secrets: { [unowned self] in self.tokens },
            stop: { [unowned self] failed in self.stops.append(failed) }
        )
    }

    private func parts() -> [Teardown] {
        ModePolicy.teardown.map { name in Teardown(name: name) { done in done(nil) } }
    }

    /// Starts in rider mode with its page up.
    private func startInRider(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertNoThrow(try controller.start(device: device, store: store, parts: parts()), file: file, line: line)
        controller.shown(PageOpener.blank)
        controller.shown("/rider.html")
        XCTAssertEqual(controller.current, .rider, file: file, line: line)
        XCTAssertEqual(controller.exposed, "RiderMode", file: file, line: line)
        XCTAssertEqual(loader.paths, ["/index.html", "/rider.html"], file: file, line: line)
        // The start page hides the screens; each test then reads only its own steps.
        XCTAssertEqual(screens.log, ["hide"], file: file, line: line)
        screens.log = []
    }

    private func call(_ plugin: Mode, _ name: String, _ args: [String: Any] = [:]) -> FakeCall {
        let call = FakeCall()
        controller.handle(plugin, name, args, call)
        return call
    }

    /// From rider mode through a passing lock to instructor mode with its page up.
    private func enterInstructor(file: StaticString = #filePath, line: UInt = #line) {
        startInRider(file: file, line: line)
        let ask = call(.rider, "askInstructorMode")
        lock.answer(true)
        // The page that asked is replaced, so its call ends with the refused word.
        XCTAssertTrue(ask.refusedOnly, file: file, line: line)
        controller.shown(PageOpener.blank)
        controller.shown("/instructor.html")
        XCTAssertEqual(controller.current, .instructor, file: file, line: line)
        XCTAssertEqual(controller.exposed, "InstructorMode", file: file, line: line)
    }

    func testTheWrongTeardownIsRefused() {
        XCTAssertThrowsError(try controller.start(device: device, store: store, parts: Array(parts().dropLast())))
    }

    func testEveryEntryAsksTheLockAfresh() {
        startInRider()
        let first = call(.rider, "askInstructorMode")
        XCTAssertEqual(lock.asks, 1)
        lock.answer(false)
        XCTAssertEqual(first.result, "notConfirmed")
        let second = call(.rider, "askInstructorMode")
        XCTAssertEqual(lock.asks, 2)
        lock.answer(true)
        XCTAssertTrue(second.refusedOnly)
        controller.shown(PageOpener.blank)
        controller.shown("/instructor.html")
        // Back to rider mode and in again: asked a third time, never reusing a pass.
        let toRider = call(.instructor, "askRiderMode")
        screens.toRider?()
        XCTAssertTrue(toRider.refusedOnly)
        controller.shown(PageOpener.blank)
        controller.shown("/rider.html")
        XCTAssertEqual(controller.current, .rider)
        _ = call(.rider, "askInstructorMode")
        XCTAssertEqual(lock.asks, 3)
    }

    func testAFailedOrCancelledCheckStaysInRiderMode() {
        startInRider()
        let ask = call(.rider, "askInstructorMode")
        lock.answer(false)
        XCTAssertEqual(ask.result, "notConfirmed")
        XCTAssertEqual(controller.current, .rider)
        XCTAssertEqual(controller.exposed, "RiderMode")
        XCTAssertEqual(screens.log, ["hide"])
        XCTAssertEqual(loader.paths, ["/index.html", "/rider.html"])
        XCTAssertEqual(store.value, Mode.rider.stored)
        XCTAssertFalse(controller.mayShow("/instructor.html"))
    }

    func testWithNoPasscodeThereIsNoInstructorModeAndTheScreenSaysAPasscodeIsNeeded() {
        lock.isSet = false
        startInRider()
        let ask = call(.rider, "askInstructorMode")
        XCTAssertEqual(lock.asks, 0)
        XCTAssertEqual(screens.log, ["noLock"])
        XCTAssertNil(ask.result)
        screens.stay?()
        XCTAssertEqual(ask.result, "stayed")
        XCTAssertEqual(controller.current, .rider)
        XCTAssertEqual(controller.exposed, "RiderMode")
        XCTAssertEqual(lock.asks, 0)
    }

    func testThePasscodeScreenSaysAPasscodeIsNeeded() {
        XCTAssertEqual(AlertScreens.noLockTitle, "A passcode is needed")
        XCTAssertTrue(AlertScreens.noLockMessage.contains("needs a passcode"))
        XCTAssertEqual(AlertScreens.noLockStay, "Stay in rider mode")
        XCTAssertFalse(DeviceLock.reason.isEmpty)
    }

    func testBackInTheAppAfterSettingAPasscodeAsksTheLock() {
        lock.isSet = false
        startInRider()
        let ask = call(.rider, "askInstructorMode")
        controller.resumed()
        XCTAssertEqual(lock.asks, 0, "still no passcode: nothing to ask")
        lock.isSet = true
        controller.resumed()
        XCTAssertEqual(lock.asks, 1)
        lock.answer(false)
        XCTAssertEqual(ask.result, "notConfirmed")
        XCTAssertEqual(controller.current, .rider)
    }

    func testAPassingCheckOpensInstructorModeThroughTheBlankPage() {
        startInRider()
        let ask = call(.rider, "askInstructorMode")
        lock.answer(true)
        XCTAssertTrue(ask.refusedOnly)
        // Every part dropped at once, so the holder is in instructor mode; its plugin waits for the blank page.
        XCTAssertEqual(controller.current, .instructor)
        XCTAssertNil(controller.exposed)
        XCTAssertEqual(screens.log, ["switching instructor"])
        XCTAssertEqual(loader.paths.suffix(1), ["/index.html"])
        XCTAssertFalse(controller.mayShow("/instructor.html"), "nothing but the blank page while the last one clears")
        XCTAssertTrue(controller.mayShow("/index.html"))
        controller.shown(PageOpener.blank)
        XCTAssertEqual(controller.exposed, "InstructorMode")
        XCTAssertEqual(loader.paths.suffix(1), ["/instructor.html"])
        controller.shown("/instructor.html")
        XCTAssertEqual(screens.log.last, "hide")
        XCTAssertEqual(controller.current, .instructor)
        XCTAssertEqual(store.value, Mode.instructor.stored)
        XCTAssertTrue(controller.mayShow("/room.html"))
        XCTAssertFalse(controller.mayShow("/rider.html"))
    }

    func testALockAnswerNobodyAskedForOpensNothing() {
        startInRider()
        controller.lockAnswered(true)
        XCTAssertEqual(controller.current, .rider)
        XCTAssertEqual(controller.exposed, "RiderMode")
    }

    func testTheFollowIntentAnswersUnavailable() {
        enterInstructor()
        let access = call(.instructor, "followAccess")
        XCTAssertEqual(access.answers.count, 1)
        XCTAssertEqual(access.answers.first?["granted"] as? Bool, false)
        XCTAssertEqual(access.answers.first?["state"] as? String, "unavailable")
        let follow = call(.instructor, "follow")
        XCTAssertEqual(follow.answers.count, 1)
        XCTAssertEqual(follow.answers.first?["state"] as? String, "unavailable")
        XCTAssertEqual(follow.answers.first?.count, 1)
    }

    func testOnlyTheCurrentModesPluginIsServed() {
        startInRider()
        XCTAssertTrue(call(.instructor, "follow").refusedOnly, "instructor plugin in rider mode")
        XCTAssertTrue(call(.rider, "follow").refusedOnly, "an instructor intent on the rider plugin")
        XCTAssertTrue(call(.rider, "nope").refusedOnly, "an unknown intent")
        XCTAssertTrue(call(.rider, "join", ["session": "s"]).refusedOnly, "a missing argument")
        XCTAssertTrue(call(.rider, "leave", ["x": 1]).refusedOnly, "an unexpected argument")
        XCTAssertEqual(call(.rider, "leave").answers.first?["result"] as? String, "left")
        XCTAssertEqual(call(.rider, "join", ["session": "s", "nickname": "n"]).answers.first?["result"] as? String, "unreachable")
    }

    func testBetweenModesEveryCallIsRefused() {
        startInRider()
        _ = call(.rider, "askInstructorMode")
        lock.answer(true)
        XCTAssertTrue(call(.rider, "leave").refusedOnly)
        XCTAssertTrue(call(.instructor, "follow").refusedOnly)
        controller.shown(PageOpener.blank)
        // Instructor mode's plugin is on now, and only it.
        XCTAssertTrue(call(.rider, "leave").refusedOnly)
        XCTAssertEqual(call(.instructor, "follow").answers.count, 1)
    }

    func testAnAnswerThatWouldCarryATokenIsRefused() {
        startInRider()
        tokens = [Secrets.token()]
        XCTAssertEqual(call(.rider, "leave").answers.count, 1)
        tokens = ["unreachable"]
        XCTAssertTrue(call(.rider, "join", ["session": "s", "nickname": "n"]).refusedOnly)
    }

    func testTheWayInFollowsThePairing() {
        startInRider()
        XCTAssertEqual(call(.rider, "instructorWay").answers.first?["way"] as? String, "lock")
        device.paired = false
        XCTAssertEqual(call(.rider, "instructorWay").answers.first?["way"] as? String, "pair")
        let ask = call(.rider, "askInstructorMode")
        XCTAssertEqual(ask.result, "unpaired")
        XCTAssertEqual(lock.asks, 0)
    }

    func testTheRiderQuestionStaysOrSwitches() {
        enterInstructor()
        let stay = call(.instructor, "askRiderMode")
        XCTAssertEqual(screens.log.last, "question")
        screens.stay?()
        XCTAssertEqual(stay.result, "stayed")
        XCTAssertEqual(controller.current, .instructor)
        let leaving = call(.instructor, "askRiderMode")
        controller.stopped()
        XCTAssertEqual(leaving.result, "stayed", "leaving the app means stay")
        let toRider = call(.instructor, "askRiderMode")
        screens.toRider?()
        XCTAssertTrue(toRider.refusedOnly)
        XCTAssertNil(controller.exposed)
        controller.shown(PageOpener.blank)
        controller.shown("/rider.html")
        XCTAssertEqual(controller.current, .rider)
        XCTAssertEqual(controller.exposed, "RiderMode")
        XCTAssertEqual(store.value, Mode.rider.stored)
    }

    func testASecondQuestionWhileOneIsOpenIsRefused() {
        startInRider()
        let first = call(.rider, "askInstructorMode")
        let second = call(.rider, "askInstructorMode")
        XCTAssertTrue(second.refusedOnly)
        XCTAssertEqual(lock.asks, 1)
        lock.answer(false)
        XCTAssertEqual(first.result, "notConfirmed")
    }

    func testAReopenInInstructorModeAsksTheLockFirst() {
        store.value = Mode.instructor.stored
        XCTAssertNoThrow(try controller.start(device: device, store: store, parts: parts()))
        XCTAssertEqual(lock.asks, 1)
        XCTAssertEqual(controller.current, .rider)
        controller.shown(PageOpener.blank)
        XCTAssertEqual(controller.exposed, "RiderMode")
        lock.answer(false)
        XCTAssertEqual(controller.current, .rider)
    }

    func testAFailedDropStopsTheApp() {
        var failing = parts()
        failing[0] = Teardown(name: failing[0].name) { done in done(NSError(domain: "x", code: 1)) }
        XCTAssertNoThrow(try controller.start(device: device, store: store, parts: failing))
        controller.shown(PageOpener.blank)
        controller.shown("/rider.html")
        _ = call(.rider, "askInstructorMode")
        lock.answer(true)
        XCTAssertEqual(stops, [[failing[0].name]])
        XCTAssertNil(controller.exposed)
    }

    func testThePhoneIsPairedOnlyWhileThePairingHoldsATokenAndItsLockIsTheDevicesPasscode() {
        var held = false
        let phone = PhoneDevice(lock: lock) { held }
        XCTAssertFalse(phone.paired)
        held = true
        XCTAssertTrue(phone.paired)
        held = false
        XCTAssertFalse(phone.paired)
        lock.isSet = false
        XCTAssertFalse(phone.secureLock)
        lock.isSet = true
        XCTAssertTrue(phone.secureLock)
    }
}
