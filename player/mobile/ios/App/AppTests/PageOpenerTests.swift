import XCTest
@testable import App

// The same cases as Android's PageOpenerTest.kt (issue #895): a mode's plugin reaches the bridge
// only once the last mode's page is gone.
final class PageOpenerTests: XCTestCase {
    private final class Steps: PageSteps {
        var log: [String] = []

        /// Which plugin is on the bridge, as the fake bridge sees it.
        var exposed: Mode?

        func expose(_ mode: Mode?) {
            exposed = mode
            log.append("expose \(mode.map { $0.stored } ?? "nil")")
        }

        func load(_ path: String) { log.append("load \(path)") }

        func ready() { log.append("ready") }
    }

    private var steps = Steps()
    private var opener: PageOpener!
    private let blank = PageOpener.blank

    override func setUp() {
        super.setUp()
        steps = Steps()
        opener = PageOpener(steps)
    }

    func testASwitchTakesEveryPluginOffAndLoadsTheBlankPageFirst() {
        steps.exposed = .rider
        opener.open(.instructor)
        XCTAssertEqual(steps.log, ["expose nil", "load \(blank)"])
        XCTAssertNil(steps.exposed)
    }

    func testTheNewModesPluginGoesOnOnlyAfterTheBlankPageHasReplacedTheLastPage() {
        opener.open(.instructor)
        // The rider page is still the document: anything it reports changes nothing.
        opener.committed("/rider.html")
        XCTAssertNil(steps.exposed)
        opener.committed(blank)
        XCTAssertEqual(steps.exposed, .instructor)
        XCTAssertEqual(steps.log, ["expose nil", "load \(blank)", "expose instructor", "load /instructor.html"])
        opener.committed("/instructor.html")
        XCTAssertEqual(steps.log.last, "ready")
    }

    func testTheSameOrderInTheOtherDirection() {
        opener.open(.rider)
        opener.committed("/instructor.html")
        opener.committed("/room.html")
        XCTAssertNil(steps.exposed)
        opener.committed(blank)
        opener.committed("/rider.html")
        XCTAssertEqual(steps.log, ["expose nil", "load \(blank)", "expose rider", "load /rider.html", "ready"])
    }

    func testWhileTheLastPageIsClearedOnlyTheBlankPageMayLoad() {
        opener.open(.rider)
        XCTAssertEqual(opener.mayShow(blank), true)
        for page in ModePolicy.pages(.rider) + ModePolicy.pages(.instructor) {
            XCTAssertEqual(opener.mayShow(page), false, page)
        }
        opener.committed(blank)
        // Then the mode's own pages decide (ModePolicy.mayShow).
        XCTAssertNil(opener.mayShow(blank))
        XCTAssertNil(opener.mayShow("/rider.html"))
    }

    func testReportsAfterTheStartPageOrWithNothingOpeningChangeNothing() {
        opener.committed(blank)
        opener.committed("/rider.html")
        XCTAssertTrue(steps.log.isEmpty)
        XCTAssertNil(opener.mayShow(blank))
        opener.open(.rider)
        opener.committed(blank)
        opener.committed("/rider.html")
        steps.log.removeAll()
        opener.committed(blank)
        opener.committed("/rider.html")
        XCTAssertTrue(steps.log.isEmpty)
        XCTAssertNotNil(steps.exposed)
    }
}
