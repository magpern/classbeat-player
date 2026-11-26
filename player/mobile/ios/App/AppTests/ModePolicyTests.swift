import XCTest
@testable import App

// The same table as Android's ModePolicyTest.kt (issue #895).
final class ModePolicyTests: XCTestCase {
    private let bools = [false, true]

    func testAFirstLaunchOrAnyValueButInstructorOpensInRiderMode() {
        for stored in [nil, "", "rider", "Instructor", "instructor ", "room", "unlocked"] as [String?] {
            for paired in bools {
                for lock in bools {
                    XCTAssertEqual(ModePolicy.startMode(stored, paired: paired, secureLock: lock), .rider)
                }
            }
        }
    }

    func testInstructorModeReopensOnlyWhileStillPairedAndLocked() {
        XCTAssertEqual(ModePolicy.startMode("instructor", paired: true, secureLock: true), .instructor)
        XCTAssertEqual(ModePolicy.startMode("instructor", paired: false, secureLock: true), .rider)
        XCTAssertEqual(ModePolicy.startMode("instructor", paired: true, secureLock: false), .rider)
    }

    func testTheWayInIsPairingThenALockThenThePrompt() {
        XCTAssertEqual(ModePolicy.entry(paired: false, secureLock: true), .pair)
        XCTAssertEqual(ModePolicy.entry(paired: false, secureLock: false), .pair)
        XCTAssertEqual(ModePolicy.entry(paired: true, secureLock: false), .noLock)
        XCTAssertEqual(ModePolicy.entry(paired: true, secureLock: true), .askLock)
    }

    func testOnlyAnAskedPassedPromptOnAPairedLockedDeviceOpensInstructorMode() {
        for a in bools {
            for p in bools {
                for d in bools {
                    for l in bools {
                        XCTAssertEqual(ModePolicy.opensInstructor(asked: a, passed: p, paired: d, secureLock: l), a && p && d && l)
                    }
                }
            }
        }
    }

    func testTheTwoModesShareNoPageAndNothingShowsBetweenModes() {
        let rider = Set(ModePolicy.pages(.rider))
        let instructor = Set(ModePolicy.pages(.instructor))
        XCTAssertTrue(rider.intersection(instructor).isEmpty)
        XCTAssertEqual(ModePolicy.startPage(.rider), "/rider.html")
        XCTAssertEqual(ModePolicy.startPage(.instructor), "/instructor.html")
        for path in rider.union(instructor).union(["/", "/index.html"]) {
            XCTAssertFalse(ModePolicy.mayShow(nil, path), path)
        }
        XCTAssertFalse(ModePolicy.mayShow(.rider, "/room.html"))
        XCTAssertFalse(ModePolicy.mayShow(.rider, "/instructor.html"))
        XCTAssertFalse(ModePolicy.mayShow(.instructor, "/rider.html"))
        XCTAssertTrue(ModePolicy.mayShow(.instructor, "/room.html"))
        for mode in Mode.allCases {
            XCTAssertFalse(ModePolicy.mayShow(mode, "/index.html"))
        }
    }

    func testASwitchDropsTheRidersNumbersAsWellAsEverythingOfTheInstructors() {
        XCTAssertEqual(
            ModePolicy.teardown,
            ["follower", "connections", "instructorState", "riderSession", "riderNumbers", "webStorage"]
        )
    }

    func testEachModeHasItsOwnStoredValueAndPlugin() {
        XCTAssertEqual(Mode.rider.stored, "rider")
        XCTAssertEqual(Mode.instructor.stored, "instructor")
        XCTAssertEqual(Mode.rider.plugin, "RiderMode")
        XCTAssertEqual(Mode.instructor.plugin, "InstructorMode")
    }
}
