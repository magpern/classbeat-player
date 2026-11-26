import XCTest
@testable import App

// The same cases as Android's ModeHolderTest.kt (issue #895).
final class ModeHolderTests: XCTestCase {
    private struct Stuck: Error {}

    /// Everything the holder did, in order: store writes, effects and drops.
    private final class Log {
        var lines: [String] = []
    }

    private final class Store: ModeStore {
        var value: String?
        let log: Log
        var fails = false

        /// The wipe flag; not logged, so the logs below stay exact.
        var wipe = false
        var flagFails = false

        init(_ value: String?, _ log: Log) {
            self.value = value
            self.log = log
        }

        func read() -> String? { value }

        func write(_ value: String) throws {
            if fails { throw Stuck() }
            self.value = value
            log.lines.append("write \(value)")
        }

        func wipePending() -> Bool { wipe }

        func setWipePending(_ pending: Bool) throws {
            if flagFails { throw Stuck() }
            wipe = pending
        }
    }

    private final class FakeDevice: Device {
        var paired: Bool
        var secureLock: Bool

        init(paired: Bool, secureLock: Bool) {
            self.paired = paired
            self.secureLock = secureLock
        }
    }

    private final class Effects: ModeEffects {
        let log: Log
        init(_ log: Log) { self.log = log }
        func closeBridge() { log.lines.append("close") }
        func open(_ mode: Mode) { log.lines.append("open \(ModeHolderTests.name(mode))") }
        func askLock() { log.lines.append("askLock") }
        func showNoLock() { log.lines.append("noLock") }
        func askRiderQuestion() { log.lines.append("question") }
        func showSwitching(_ mode: Mode) { log.lines.append("switching \(ModeHolderTests.name(mode))") }
        func fatal(_ failed: [String]) { log.lines.append("fatal \(failed)") }
    }

    fileprivate static func name(_ mode: Mode) -> String { mode == .rider ? "RIDER" : "INSTRUCTOR" }

    private var log = Log()
    private var effects: [Effects] = []

    /// State each part holds; a drop empties it.
    private var state: [String: [String]] = [:]
    private var failing: Set<String> = []

    /// Parts whose drop finishes only when the test says so, as the web view's storage wipe does.
    private var later: Set<String> = []
    private var unfinished: [String: (Error?) -> Void] = [:]
    private var parts: [Teardown] = []

    override func setUp() {
        super.setUp()
        log = Log()
        effects = []
        state = Dictionary(uniqueKeysWithValues: ModePolicy.teardown.map { ($0, ["left"]) })
        failing = []
        later = []
        unfinished = [:]
        parts = ModePolicy.teardown.map { name in
            Teardown(name: name) { [unowned self] done in
                if self.failing.contains(name) { throw Stuck() }
                self.log.lines.append("drop \(name)")
                let finish: (Error?) -> Void = { [unowned self] error in
                    if error == nil { self.state[name] = [] }
                    self.log.lines.append("dropped \(name)")
                    done(error)
                }
                if self.later.contains(name) { self.unfinished[name] = finish } else { finish(nil) }
            }
        }
    }

    private var lines: [String] { log.lines }

    /// Every drop, started and finished, in teardown order.
    private func drops() -> [String] {
        ModePolicy.teardown.flatMap { ["drop \($0)", "dropped \($0)"] }
    }

    private func holder(_ stored: String?, paired: Bool, lock: Bool, store: Store? = nil) -> (ModeHolder, FakeDevice) {
        let device = FakeDevice(paired: paired, secureLock: lock)
        let e = Effects(log)
        effects.append(e)
        let h = try! ModeHolder(store: store ?? Store(stored, log), device: device, effects: e, parts: parts)
        return (h, device)
    }

    /// Passes the screen lock a reopen in instructor mode asked for, every drop finishing at once.
    private func enter(_ h: ModeHolder, file: StaticString = #filePath, line: UInt = #line) {
        let held = (failing, later)
        failing = []
        later = []
        XCTAssertTrue(h.lockAnswered(true), file: file, line: line)
        failing = held.0
        later = held.1
        XCTAssertEqual(h.current, .instructor, file: file, line: line)
    }

    private func instructor() -> ModeHolder {
        let (h, _) = holder("instructor", paired: true, lock: true)
        h.start()
        enter(h)
        for key in state.keys { state[key]!.append("instructor") }
        log.lines.removeAll()
        return h
    }

    private func allEmpty(except: String? = nil) -> Bool {
        state.filter { $0.key != except }.values.allSatisfy { $0.isEmpty }
    }

    func testAFirstLaunchOnAnUnpairedDeviceIsInRiderMode() {
        let store = Store(nil, log)
        let (h, _) = holder(nil, paired: false, lock: true, store: store)
        h.start()
        XCTAssertEqual(h.current, .rider)
        XCTAssertEqual(store.value, "rider")
        XCTAssertEqual(lines, ["write rider", "open RIDER"])
    }

    func testAReopenInInstructorModeAsksForTheScreenLockAgainBeforeAnythingOfItShows() {
        let store = Store("instructor", log)
        let (h, _) = holder("instructor", paired: true, lock: true, store: store)
        h.start()
        // Rider mode, the safe one, is open under the prompt; instructor mode is not.
        XCTAssertEqual(h.current, .rider)
        XCTAssertEqual(h.pending, .lock)
        XCTAssertEqual(lines, ["write rider", "open RIDER", "askLock"])
        XCTAssertTrue(h.lockAnswered(true))
        XCTAssertEqual(h.current, .instructor)
        XCTAssertEqual(store.value, "instructor")
        XCTAssertEqual(Array(lines.dropFirst(3)), ["close", "switching INSTRUCTOR"] + drops() + ["write instructor", "open INSTRUCTOR"])
    }

    func testAReopenWhoseLockIsRefusedStaysInRiderModeAndTheNextReopenAsksNothing() {
        let store = Store("instructor", log)
        let (h, _) = holder("instructor", paired: true, lock: true, store: store)
        h.start()
        XCTAssertFalse(h.lockAnswered(false))
        XCTAssertEqual(h.current, .rider)
        XCTAssertNil(h.pending)
        XCTAssertFalse(lines.contains { $0.contains("INSTRUCTOR") })
        // A late second answer opens nothing either.
        XCTAssertFalse(h.lockAnswered(true))
        XCTAssertEqual(store.value, "rider")
        log.lines.removeAll()
        holder("rider", paired: true, lock: true, store: store).0.start()
        XCTAssertEqual(lines, ["write rider", "open RIDER"])
    }

    func testAReopenInInstructorModeWithNoScreenLockOrNoPairingFallsBackToRiderMode() {
        for (paired, lock) in [(true, false), (false, true)] {
            log.lines.removeAll()
            let (h, _) = holder("instructor", paired: paired, lock: lock)
            h.start()
            XCTAssertEqual(h.current, .rider)
            XCTAssertNil(h.pending)
            XCTAssertEqual(lines, ["write rider", "open RIDER"])
        }
    }

    func testAReopenInRiderModeAsksNothing() {
        let (h, _) = holder("rider", paired: true, lock: true)
        h.start()
        XCTAssertEqual(h.current, .rider)
        XCTAssertNil(h.pending)
        XCTAssertFalse(lines.contains("askLock"))
    }

    func testAReopenInInstructorModeAfterASwitchCutShortAsksForTheLockOnlyOnceTheWipeHasFinished() {
        later.insert("webStorage")
        let store = Store("instructor", log)
        store.wipe = true
        let (h, _) = holder("instructor", paired: true, lock: true, store: store)
        h.start()
        XCTAssertNil(h.current)
        XCTAssertFalse(lines.contains("askLock"))
        unfinished["webStorage"]!(nil)
        XCTAssertEqual(h.current, .rider)
        XCTAssertEqual(Array(lines.suffix(3)), ["dropped webStorage", "open RIDER", "askLock"])
        XCTAssertEqual(h.pending, .lock)
        later = []
        XCTAssertTrue(h.lockAnswered(true))
        XCTAssertEqual(h.current, .instructor)
    }

    func testALockLostWhileTheReopensWipeRanAsksNothingAndStaysInRiderMode() {
        later.insert("webStorage")
        let store = Store("instructor", log)
        store.wipe = true
        let (h, device) = holder("instructor", paired: true, lock: true, store: store)
        h.start()
        device.secureLock = false
        unfinished["webStorage"]!(nil)
        XCTAssertEqual(h.current, .rider)
        XCTAssertNil(h.pending)
        XCTAssertEqual(lines.last, "open RIDER")
        XCTAssertFalse(lines.contains("noLock"))
    }

    func testARestartInRiderModeOnAPairedDeviceStillNeedsTheLock() {
        // The last session ended in instructor mode, then switched to rider: the store says rider.
        let (h, _) = holder("rider", paired: true, lock: true)
        h.start()
        log.lines.removeAll()
        XCTAssertFalse(h.lockAnswered(true))
        XCTAssertEqual(h.current, .rider)
        XCTAssertEqual(h.askInstructor(), .askLock)
        XCTAssertEqual(lines, ["askLock"])
        XCTAssertEqual(h.current, .rider)
        XCTAssertFalse(h.lockAnswered(false))
        XCTAssertEqual(h.current, .rider)
        // A second answer to the same prompt opens nothing: the prompt is asked again each time.
        XCTAssertFalse(h.lockAnswered(true))
        XCTAssertEqual(h.current, .rider)
        _ = h.askInstructor()
        XCTAssertTrue(h.lockAnswered(true))
        XCTAssertEqual(h.current, .instructor)
    }

    func testALockPassedAfterTheDeviceLostItsPairingOrLockOpensNothing() {
        for lose in ["pairing", "lock"] {
            let (h, device) = holder("rider", paired: true, lock: true)
            h.start()
            _ = h.askInstructor()
            if lose == "pairing" { device.paired = false } else { device.secureLock = false }
            XCTAssertFalse(h.lockAnswered(true), lose)
            XCTAssertEqual(h.current, .rider, lose)
        }
    }

    func testAnUnpairedDeviceGoesToPairingAndNothingOpens() {
        let (h, _) = holder(nil, paired: false, lock: true)
        h.start()
        log.lines.removeAll()
        XCTAssertEqual(h.askInstructor(), .pair)
        XCTAssertTrue(lines.isEmpty)
        XCTAssertNil(h.pending)
    }

    func testWithNoPasscodeTheAppRefusesAndSaysOneIsNeeded() {
        let (h, device) = holder("rider", paired: true, lock: false)
        h.start()
        log.lines.removeAll()
        XCTAssertEqual(h.askInstructor(), .noLock)
        XCTAssertEqual(lines, ["noLock"])
        XCTAssertFalse(h.lockAnswered(true))
        // Back from the settings without a passcode: the same screen again.
        h.noLockReturned()
        XCTAssertEqual(lines, ["noLock", "noLock"])
        // Back with a passcode set: the prompt.
        device.secureLock = true
        h.noLockReturned()
        XCTAssertEqual(lines, ["noLock", "noLock", "askLock"])
        XCTAssertTrue(h.lockAnswered(true))
        XCTAssertEqual(h.current, .instructor)
    }

    func testStayingInRiderModeFromTheNoLockScreenEndsTheQuestion() {
        let (h, device) = holder("rider", paired: true, lock: false)
        h.start()
        _ = h.askInstructor()
        h.noLockStay()
        device.secureLock = true
        h.noLockReturned()
        XCTAssertNil(h.pending)
        XCTAssertFalse(lines.contains("askLock"))
    }

    func testNoInstructorStateSurvivesASwitchToRiderMode() {
        let h = instructor()
        XCTAssertTrue(h.askRider())
        XCTAssertEqual(lines, ["question"])
        XCTAssertTrue(h.riderAnswered(true))
        XCTAssertEqual(h.current, .rider)
        XCTAssertTrue(allEmpty())
        XCTAssertEqual(Array(lines.dropFirst()), ["close", "switching RIDER", "write rider"] + drops() + ["open RIDER"])
    }

    func testASwitchToInstructorModeDropsEverythingTooTheRidersNumbersIncluded() {
        let (h, _) = holder("rider", paired: true, lock: true)
        h.start()
        for key in state.keys { state[key]!.append("rider") }
        log.lines.removeAll()
        _ = h.askInstructor()
        _ = h.lockAnswered(true)
        XCTAssertTrue(allEmpty())
        XCTAssertEqual(lines, ["askLock", "close", "switching INSTRUCTOR"] + drops() + ["write instructor", "open INSTRUCTOR"])
    }

    func testStayingOrAQuestionNotAskedSwitchesNothing() {
        let h = instructor()
        XCTAssertFalse(h.riderAnswered(true))
        _ = h.askRider()
        XCTAssertFalse(h.riderAnswered(false))
        XCTAssertEqual(h.current, .instructor)
        XCTAssertFalse(h.riderAnswered(true))
        XCTAssertEqual(lines, ["question"])
    }

    func testEachModeAsksOnlyForTheOther() {
        let h = instructor()
        XCTAssertNil(h.askInstructor())
        let (r, _) = holder("rider", paired: true, lock: true)
        r.start()
        XCTAssertFalse(r.askRider())
    }

    func testAPartThatCannotBeDroppedStopsTheAppAndOpensNoPage() {
        for name in ModePolicy.teardown {
            failing = [name]
            let h = instructor()
            _ = h.askRider()
            XCTAssertFalse(h.riderAnswered(true), name)
            XCTAssertNil(h.current, name)
            XCTAssertEqual(lines.last, "fatal [\"\(name)\"]", name)
            XCTAssertFalse(lines.contains { $0.hasPrefix("open") }, name)
            // Every other part was still dropped.
            XCTAssertTrue(allEmpty(except: name), name)
        }
    }

    func testAStoreThatCannotBeWrittenStopsTheSwitchAndInstructorModeIsNeverWrittenEarly() {
        let store = Store("rider", log)
        let (h, _) = holder("rider", paired: true, lock: true, store: store)
        h.start()
        failing.insert("webStorage")
        _ = h.askInstructor()
        XCTAssertFalse(h.lockAnswered(true))
        XCTAssertEqual(store.value, "rider")
        XCTAssertFalse(lines.contains("write instructor"))
        failing = []
        let failingStore = Store("instructor", log)
        let (j, _) = holder("instructor", paired: true, lock: true, store: failingStore)
        j.start()
        enter(j)
        failingStore.fails = true
        _ = j.askRider()
        XCTAssertFalse(j.riderAnswered(true))
        XCTAssertNil(j.current)
        XCTAssertEqual(lines.last, "fatal [\"\(ModeHolder.storeFailure)\"]")
    }

    func testNothingCanBeAskedWhileTheAppIsBetweenModes() {
        failing.insert("follower")
        let h = instructor()
        _ = h.askRider()
        _ = h.riderAnswered(true)
        XCTAssertNil(h.current)
        XCTAssertNil(h.askInstructor())
        XCTAssertFalse(h.askRider())
        XCTAssertFalse(h.lockAnswered(true))
    }

    func testTheHolderRefusesToStartWithoutExactlyTheTeardownParts() {
        let store = Store(nil, log)
        let device = FakeDevice(paired: false, secureLock: false)
        let e = Effects(log)
        let bad: [[Teardown]] = [
            Array(parts.dropFirst()),
            parts.reversed(),
            parts + [Teardown(name: "extra") { $0(nil) }],
            parts.filter { $0.name != "riderNumbers" },
        ]
        for wrong in bad {
            XCTAssertThrowsError(try ModeHolder(store: store, device: device, effects: e, parts: wrong))
        }
    }

    func testThePageOpensOnlyAfterADropThatFinishesLaterHasFinished() {
        later.insert("webStorage")
        let h = instructor()
        _ = h.askRider()
        XCTAssertTrue(h.riderAnswered(true))
        // Still dropping: between modes, nothing opened, nothing can be asked.
        XCTAssertNil(h.current)
        XCTAssertFalse(lines.contains { $0.hasPrefix("open") })
        XCTAssertFalse(h.askRider())
        XCTAssertNil(h.askInstructor())
        // Entering instructor mode already dropped "left": what is left now is instructor mode's.
        XCTAssertEqual(state["webStorage"], ["instructor"])
        unfinished["webStorage"]!(nil)
        XCTAssertEqual(h.current, .rider)
        XCTAssertEqual(Array(lines.suffix(2)), ["dropped webStorage", "open RIDER"])
        XCTAssertTrue(allEmpty())
    }

    func testInstructorModeIsWrittenOnlyAfterADropThatFinishesLaterHasFinished() {
        later.insert("webStorage")
        let store = Store("rider", log)
        let (h, _) = holder("rider", paired: true, lock: true, store: store)
        h.start()
        _ = h.askInstructor()
        XCTAssertTrue(h.lockAnswered(true))
        XCTAssertEqual(store.value, "rider")
        unfinished["webStorage"]!(nil)
        XCTAssertEqual(store.value, "instructor")
        XCTAssertEqual(Array(lines.suffix(3)), ["dropped webStorage", "write instructor", "open INSTRUCTOR"])
    }

    func testADropThatFailsLaterStopsTheAppAndASecondAnswerFromItCountsForNothing() {
        later.insert("webStorage")
        let h = instructor()
        _ = h.askRider()
        _ = h.riderAnswered(true)
        let finish = unfinished["webStorage"]!
        finish(Stuck())
        XCTAssertEqual(lines.last, "fatal [\"webStorage\"]")
        finish(nil)
        XCTAssertNil(h.current)
        XCTAssertFalse(lines.contains { $0.hasPrefix("open") })
    }

    func testAStartAfterASwitchCutShortDropsEverythingBeforeAnyPageLoads() {
        for stored in ["rider", "instructor"] {
            log.lines.removeAll()
            for key in state.keys { state[key] = ["left"] }
            let store = Store(stored, log)
            store.wipe = true
            let (h, _) = holder(stored, paired: true, lock: true, store: store)
            h.start()
            XCTAssertTrue(allEmpty(), stored)
            let opened = lines.firstIndex { $0.hasPrefix("open") } ?? -1
            let lastDrop = lines.firstIndex(of: "dropped \(ModePolicy.teardown.last!)") ?? Int.max
            XCTAssertGreaterThan(opened, lastDrop, stored)
            // Rider mode opens; a reopen toward instructor mode then asks for the lock.
            let tail = stored == "instructor" ? ["open RIDER", "askLock"] : ["open RIDER"]
            XCTAssertEqual(Array(lines.suffix(tail.count)), tail, stored)
            XCTAssertEqual(lines.filter { $0.hasPrefix("open") }.count, 1, stored)
            XCTAssertFalse(store.wipe, stored)
        }
    }

    func testASwitchTheAppWasKilledInLeavesTheFlagAndTheNextStartFinishesTheWipe() {
        later.insert("webStorage")
        let store = Store("instructor", log)
        let (h, _) = holder("instructor", paired: true, lock: true, store: store)
        h.start()
        enter(h)
        for key in state.keys { state[key]!.append("instructor") }
        _ = h.askRider()
        _ = h.riderAnswered(true)
        // Killed here: webStorage never finished.
        XCTAssertTrue(store.wipe)
        XCTAssertEqual(store.value, "rider")
        later = []
        state["webStorage"]!.append("still here")
        log.lines.removeAll()
        let (next, _) = holder("rider", paired: true, lock: true, store: store)
        next.start()
        XCTAssertEqual(next.current, .rider)
        XCTAssertEqual(state["webStorage"], [])
        let dropped = lines.firstIndex(of: "dropped webStorage") ?? Int.max
        let opened = lines.firstIndex(of: "open RIDER") ?? -1
        XCTAssertLessThan(dropped, opened)
        XCTAssertFalse(store.wipe)
    }

    func testAFlagThatCannotBeWrittenStopsTheSwitch() {
        let store = Store("instructor", log)
        let (h, _) = holder("instructor", paired: true, lock: true, store: store)
        h.start()
        enter(h)
        log.lines.removeAll()
        store.flagFails = true
        _ = h.askRider()
        XCTAssertFalse(h.riderAnswered(true))
        XCTAssertEqual(store.value, "rider")
        XCTAssertEqual(lines.last, "fatal [\"\(ModeHolder.storeFailure)\"]")
        XCTAssertFalse(lines.contains { $0.hasPrefix("open") })
    }

    func testASecondAnswerFromOneDropOpensNothingWhileAnotherDropIsStillPending() {
        later = ["webStorage", "follower"]
        let h = instructor()
        _ = h.askRider()
        XCTAssertTrue(h.riderAnswered(true))
        let web = unfinished["webStorage"]!
        web(nil)
        web(nil)
        XCTAssertNil(h.current)
        XCTAssertFalse(lines.contains { $0.hasPrefix("open") })
        unfinished["follower"]!(nil)
        XCTAssertEqual(h.current, .rider)
        XCTAssertEqual(lines.filter { $0.hasPrefix("open") }.count, 1)
    }

    func testUnpairingInInstructorModeSwitchesToRiderModeWithNoQuestion() {
        let h = instructor()
        h.unpaired()
        XCTAssertEqual(h.current, .rider)
        XCTAssertFalse(lines.contains("question"))
        XCTAssertTrue(allEmpty())
        let (r, _) = holder("rider", paired: true, lock: true)
        r.start()
        log.lines.removeAll()
        r.unpaired()
        XCTAssertTrue(lines.isEmpty)
    }
}
