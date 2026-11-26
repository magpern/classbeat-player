import XCTest
@testable import App

// The same table as Android's KeepAwakePolicyTest.kt (issue #897).
final class KeepAwakePolicyTests: XCTestCase {
    private let bools = [false, true]
    private let paths: [String?] = [nil, "/index.html", "/instructor.html", "/room.html", "/rider.html"]

    func testInstructorModeKeepsTheScreenOnOnTheClassPageOnlyInTheForeground() {
        for path in paths {
            for joined in bools {
                XCTAssertEqual(KeepAwakePolicy.keepOn(.instructor, path, riderJoined: joined, foreground: true), path == "/room.html")
                XCTAssertFalse(KeepAwakePolicy.keepOn(.instructor, path, riderJoined: joined, foreground: false))
            }
        }
    }

    func testRiderModeKeepsTheScreenOnWhileJoinedInTheForegroundWhateverPage() {
        for path in paths {
            XCTAssertTrue(KeepAwakePolicy.keepOn(.rider, path, riderJoined: true, foreground: true))
            XCTAssertFalse(KeepAwakePolicy.keepOn(.rider, path, riderJoined: false, foreground: true))
            XCTAssertFalse(KeepAwakePolicy.keepOn(.rider, path, riderJoined: true, foreground: false))
            XCTAssertFalse(KeepAwakePolicy.keepOn(.rider, path, riderJoined: false, foreground: false))
        }
    }

    func testBetweenModesTheScreenIsNeverKeptOn() {
        for path in paths {
            for joined in bools {
                for foreground in bools {
                    XCTAssertFalse(KeepAwakePolicy.keepOn(nil, path, riderJoined: joined, foreground: foreground))
                }
            }
        }
    }

    func testTheClassPageIsInstructorModesClassPage() {
        XCTAssertTrue(ModePolicy.pages(.instructor).contains(KeepAwakePolicy.classPage))
        XCTAssertNotEqual(KeepAwakePolicy.classPage, ModePolicy.startPage(.instructor))
    }

    func testTheInstructorClassPageDoesNotCountInRiderMode() {
        XCTAssertFalse(KeepAwakePolicy.keepOn(.rider, "/room.html", riderJoined: false, foreground: true))
    }
}
