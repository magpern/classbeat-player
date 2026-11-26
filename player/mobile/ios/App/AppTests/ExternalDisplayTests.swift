import XCTest
@testable import App

/// Fake external displays: the ids connected now, and the listener to tell.
final class FakeDisplays: DisplaySource {
    var ids: [Int] = []
    var changed: (() -> Void)?

    func presentationDisplays() -> [Int] { ids }
    func watch(_ changed: @escaping () -> Void) { self.changed = changed }
    func stopWatching() { changed = nil }

    func plugIn(_ id: Int) {
        ids.append(id)
        changed?()
    }

    func unplug(_ id: Int) {
        ids.removeAll { $0 == id }
        changed?()
    }
}

/// A fake room surface: every call, and the callbacks of the last show.
final class FakeSurface: RoomSurface {
    var log: [String] = []
    var gone: (() -> Void)?
    var crashed: (() -> Void)?

    func show(_ id: Int, _ page: String, gone: @escaping () -> Void, crashed: @escaping () -> Void) {
        log.append("show \(id) \(page)")
        self.gone = gone
        self.crashed = crashed
    }

    func load(_ page: String) { log.append("load \(page)") }
    func dismiss() { log.append("dismiss") }
}

// The same cases as Android's ExternalDisplayTest.kt (issue #897).
final class ExternalDisplayTests: XCTestCase {
    private var displays: FakeDisplays!
    private var surface: FakeSurface!
    private var ext: ExternalDisplay!

    override func setUp() {
        super.setUp()
        displays = FakeDisplays()
        surface = FakeSurface()
        ext = ExternalDisplay(source: displays, surface: surface)
        ext.start()
    }

    private func classOpen() {
        ext.update(.instructor, "/room.html", foreground: true)
    }

    func testADisplayConnectedDuringAClassShowsTheIdleStage() {
        classOpen()
        XCTAssertEqual(surface.log, [])
        displays.plugIn(2)
        XCTAssertEqual(surface.log, ["show 2 /display.html"])
    }

    func testADisplayAlreadyThereKeepsTheIdleStageThroughAClassWithNoReload() {
        displays.plugIn(2)
        ext.update(.instructor, "/instructor.html", foreground: true)
        XCTAssertEqual(surface.log, ["show 2 /display.html"])
        classOpen()
        ext.update(.instructor, "/instructor.html", foreground: true)
        XCTAssertEqual(surface.log, ["show 2 /display.html"])
    }

    func testAChangeOfPageOnADisplayAlreadyShowingLoadsItThere() {
        displays.plugIn(2)
        classOpen()
        ext.update(.rider, "/rider.html", foreground: true)
        classOpen()
        XCTAssertEqual(surface.log, ["show 2 /display.html", "load /display-rider.html", "load /display.html"])
    }

    func testDisconnectMidClassDismissesAndReconnectShowsAgain() {
        classOpen()
        displays.plugIn(2)
        displays.unplug(2)
        XCTAssertEqual(surface.log, ["show 2 /display.html", "dismiss"])
        displays.plugIn(3)
        XCTAssertEqual(surface.log, ["show 2 /display.html", "dismiss", "show 3 /display.html"])
    }

    func testRiderModeAndTheAppBetweenModesShowTheIdleStageNeverTheRoomScreen() {
        displays.plugIn(2)
        ext.update(.rider, "/rider.html", foreground: true)
        ext.update(.rider, "/room.html", foreground: true)
        // Rider mode shows the rider's line; between modes the instructor's.
        XCTAssertEqual(surface.log, ["show 2 /display-rider.html"])
        ext.update(nil, nil, foreground: true)
        classOpen()
        XCTAssertEqual(surface.log, ["show 2 /display-rider.html", "load /display.html"])
        ext.update(.rider, nil, foreground: false)
        XCTAssertEqual(surface.log, ["show 2 /display-rider.html", "load /display.html", "dismiss"])
    }

    func testGoingToTheBackgroundDismissesAndComingBackShowsAgain() {
        displays.plugIn(2)
        classOpen()
        ext.update(.instructor, "/room.html", foreground: false)
        classOpen()
        XCTAssertEqual(surface.log, ["show 2 /display.html", "dismiss", "show 2 /display.html"])
    }

    func testRepeatedUpdatesAndEventsShowItOnceAndASecondDisplayChangesNothing() {
        displays.plugIn(2)
        classOpen()
        classOpen()
        displays.plugIn(5)
        XCTAssertEqual(surface.log, ["show 2 /display.html"])
    }

    func testADisplayTheSystemTookDownIsShownAgainOnTheNextChange() {
        displays.plugIn(2)
        classOpen()
        surface.gone?()
        classOpen()
        XCTAssertEqual(surface.log, ["show 2 /display.html", "show 2 /display.html"])
    }

    func testADeadContentProcessTakesTheWebViewDownAndShowsItAgainWhileThePolicySaysSo() {
        displays.plugIn(2)
        classOpen()
        surface.crashed?()
        XCTAssertEqual(surface.log, ["show 2 /display.html", "dismiss", "show 2 /display.html"])
        ext.update(.instructor, "/room.html", foreground: false)
        surface.crashed?()
        XCTAssertEqual(surface.log, ["show 2 /display.html", "dismiss", "show 2 /display.html", "dismiss"])
    }

    func testASecondCrashOnTheSameDisplayPageAndModeStaysDownUntilOneOfThemChanges() {
        displays.plugIn(2)
        classOpen()
        surface.crashed?()
        surface.crashed?()
        let down = ["show 2 /display.html", "dismiss", "show 2 /display.html", "dismiss"]
        XCTAssertEqual(surface.log, down)
        // The same inputs again, a display event, and a trip to the background and back: still down.
        classOpen()
        displays.plugIn(5)
        ext.update(.instructor, "/room.html", foreground: false)
        classOpen()
        XCTAssertEqual(surface.log, down)
        // The class list shows the same page in the same mode: still down.
        ext.update(.instructor, "/instructor.html", foreground: true)
        XCTAssertEqual(surface.log, down)
        // A change of page shows again, with its own re-show.
        ext.update(.rider, "/rider.html", foreground: true)
        XCTAssertEqual(surface.log, down + ["show 2 /display-rider.html"])
        surface.crashed?()
        XCTAssertEqual(surface.log, down + ["show 2 /display-rider.html", "dismiss", "show 2 /display-rider.html"])
    }

    func testAfterASecondCrashAChangeOfDisplayOrOfModeShowsAgain() {
        displays.plugIn(2)
        ext.update(.instructor, "/instructor.html", foreground: true)
        surface.crashed?()
        surface.crashed?()
        displays.unplug(2)
        displays.plugIn(3)
        XCTAssertEqual(surface.log.last, "show 3 /display.html")
        surface.crashed?()
        surface.crashed?()
        let down = surface.log
        ext.update(.rider, "/rider.html", foreground: true)
        XCTAssertEqual(surface.log, down + ["show 3 /display-rider.html"])
    }

    func testACrashOrADismissalReportedLateByAShowNoLongerCurrentIsIgnored() throws {
        displays.plugIn(2)
        classOpen()
        let firstCrashed = try XCTUnwrap(surface.crashed)
        let firstGone = try XCTUnwrap(surface.gone)
        firstCrashed()
        let reshown = ["show 2 /display.html", "dismiss", "show 2 /display.html"]
        XCTAssertEqual(surface.log, reshown)
        // The first show's callbacks again, after the re-show: nothing comes down, and the budget is not spent.
        firstCrashed()
        firstGone()
        classOpen()
        XCTAssertEqual(surface.log, reshown)
        surface.crashed?()
        XCTAssertEqual(surface.log, reshown + ["dismiss"])
        // A callback of a web view already taken down changes nothing either.
        surface.crashed?()
        surface.gone?()
        XCTAssertEqual(surface.log, reshown + ["dismiss"])
    }

    func testNoDisplayToTakeDownDoesNothingAndStopDismissesAndStopsListening() {
        classOpen()
        displays.unplug(9)
        XCTAssertEqual(surface.log, [])
        displays.plugIn(2)
        ext.stop()
        XCTAssertEqual(surface.log, ["show 2 /display.html", "dismiss"])
        displays.plugIn(3)
        XCTAssertEqual(surface.log, ["show 2 /display.html", "dismiss"])
    }
}
