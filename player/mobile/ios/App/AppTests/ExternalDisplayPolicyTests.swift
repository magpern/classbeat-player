import XCTest
@testable import App

// The same table as Android's ExternalDisplayPolicyTest.kt (issue #897), with the bundle at
// capacitor://localhost.
final class ExternalDisplayPolicyTests: XCTestCase {
    private typealias Shown = ExternalDisplayPolicy.Shown
    private let room = "/room.html"
    private let idle = "/display.html"
    private let idleRider = "/display-rider.html"
    private let bools = [false, true]
    private var paths: [String?] { [nil, "/index.html", "/instructor.html", room, "/rider.html", idle, idleRider] }

    private func shown(_ mode: Mode?, _ path: String? = "/room.html", display: Bool = true, fg: Bool = true) -> Shown {
        ExternalDisplayPolicy.shown(mode, path, displayPresent: display, foreground: fg)
    }

    func testConnectDuringAClassOrOnTheClassListShowsTheIdleStage() {
        XCTAssertEqual(shown(.instructor, display: false), .none)
        XCTAssertEqual(shown(.instructor, display: true), .idle)
        XCTAssertEqual(shown(.instructor, "/instructor.html"), .idle)
        XCTAssertEqual(shown(.instructor, "/index.html"), .idle)
    }

    func testDisconnectMidClassStopsTheDisplayAndReconnectShowsTheIdleStageAgain() {
        XCTAssertEqual([true, false, true].map { shown(.instructor, display: $0) }, [.idle, .none, .idle])
    }

    func testRiderModeShowsTheRidersIdleStageAndBetweenModesTheInstructors() {
        for mode in [Mode.rider, nil] as [Mode?] {
            for path in paths {
                for display in bools {
                    for fg in bools {
                        let idleStage: Shown = mode == .rider ? .idleRider : .idle
                        XCTAssertEqual(shown(mode, path, display: display, fg: fg), display && fg ? idleStage : .none, "\(String(describing: mode)) \(String(describing: path)) \(display) \(fg)")
                    }
                }
            }
        }
    }

    func testInstructorModeEveryInputAgainstAWrittenTable() {
        for path in paths {
            for display in bools {
                for fg in bools {
                    let want: Shown = !display || !fg ? .none : .idle
                    XCTAssertEqual(shown(.instructor, path, display: display, fg: fg), want, "\(String(describing: path)) \(display) \(fg)")
                }
            }
        }
    }

    func testTheBackgroundAndNoDisplayNeverShowInAnyMode() {
        for mode in [Mode.rider, .instructor, nil] as [Mode?] {
            for path in paths {
                XCTAssertEqual(shown(mode, path, display: true, fg: false), .none)
                XCTAssertEqual(shown(mode, path, display: false, fg: true), .none)
            }
        }
    }

    func testEachShownStateMapsToItsOwnPageNoneToNoPageAndNoneToTheRoomScreen() {
        XCTAssertNil(Shown.none.page)
        XCTAssertEqual(Shown.idle.page, idle)
        XCTAssertEqual(Shown.idleRider.page, idleRider)
        XCTAssertEqual(Set(Shown.allCases.map { $0.page }).count, Shown.allCases.count)
        for state in Shown.allCases {
            XCTAssertNotEqual(state.page, room)
        }
    }

    func testTheIdlePagesBelongToNoMode() {
        for mode in Mode.allCases {
            XCTAssertFalse(ModePolicy.pages(mode).contains(ExternalDisplayPolicy.idlePage))
            XCTAssertFalse(ModePolicy.pages(mode).contains(ExternalDisplayPolicy.idleRiderPage))
        }
    }

    func testTheDisplaysWebViewLoadsTheBundleAndInItsMainFrameAnIdlePageOnly() {
        let base = NavigationPolicy.appOrigin
        XCTAssertTrue(ExternalDisplayPolicy.mayLoad("\(base)/display.html", mainFrame: true))
        XCTAssertTrue(ExternalDisplayPolicy.mayLoad("\(base)/display.html?x=1#y", mainFrame: true))
        XCTAssertTrue(ExternalDisplayPolicy.mayLoad("\(base)/display-rider.html", mainFrame: true))
        // The room screen needs the bridge, which this view has not.
        for other in [
            "/room.html", "/room.html?id=0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0", "/instructor.html", "/instructor.html#class-missing",
            "/rider.html", "/index.html", "/", "/display.html/x", "/room.htm", "/display-rider.html/x", "/display-rider.htm",
        ] {
            XCTAssertFalse(ExternalDisplayPolicy.mayLoad("\(base)\(other)", mainFrame: true), other)
        }
        XCTAssertTrue(ExternalDisplayPolicy.mayLoad("\(base)/main.js", mainFrame: false))
        XCTAssertTrue(ExternalDisplayPolicy.mayLoad("\(base)/fonts/a.woff2", mainFrame: false))
    }

    func testTheDisplaysWebViewLoadsNothingOutsideTheBundle() {
        for url in [
            "https://example.com/room.html", "http://localhost/room.html", "capacitor://localhost:8443/room.html",
            "data:text/html,x", "blob:capacitor://localhost/x", "file:///var/mobile/public/room.html",
            "capacitor://localhost/_capacitor_file_/x", "capacitor://localhost/%2e%2e/room.html", "capacitor://localhost/room.html%2f..%2fx",
            "https://example.com/display.html", "capacitor://localhost/%2e%2e/display.html",
            "https://localhost/display.html", "capacitor://example.com/display.html", "capacitor://user@localhost/display.html",
        ] {
            for main in bools {
                XCTAssertFalse(ExternalDisplayPolicy.mayLoad(url, mainFrame: main), "\(url) \(main)")
            }
        }
    }
}
