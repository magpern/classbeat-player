import XCTest
@testable import App

/// A fake idle timer: the flag as the last call left it, and every call made.
final class FakeFlag: ScreenFlag {
    var set = false
    var calls: [Bool] = []

    func keepOn(_ on: Bool) {
        set = on
        calls.append(on)
    }
}

// The wiring of the idle timer, as Android's KeepAwakeTest.kt (issue #897): it is set when the
// policy says on and cleared when it says off.
final class KeepAwakeTests: XCTestCase {
    private let bools = [false, true]
    private let modes: [Mode?] = [nil, .instructor, .rider]
    private let paths: [String?] = [nil, "/index.html", KeepAwakePolicy.classPage, "/rider.html"]

    func testEveryInputCombinationSetsOrClearsTheFlagAsThePolicySays() {
        for mode in modes {
            for path in paths {
                for joined in bools {
                    for fg in bools {
                        let expected = KeepAwakePolicy.keepOn(mode, path, riderJoined: joined, foreground: fg)
                        // Start from the opposite state, so a call that does nothing cannot pass.
                        let flag = FakeFlag()
                        flag.set = !expected
                        KeepAwake(flag).sync(mode, path, riderJoined: joined, foreground: fg)
                        XCTAssertEqual(flag.set, expected, "\(String(describing: mode)) \(String(describing: path)) \(joined) \(fg)")
                        XCTAssertEqual(flag.calls.count, 1)
                    }
                }
            }
        }
    }

    func testEachInputChangeMovesTheFlag() {
        let flag = FakeFlag()
        let awake = KeepAwake(flag)
        let room = KeepAwakePolicy.classPage
        // Instructor: the class page, in the foreground.
        awake.sync(.instructor, "/instructor.html", riderJoined: false, foreground: true)
        XCTAssertFalse(flag.set)
        awake.sync(.instructor, room, riderJoined: false, foreground: true)
        XCTAssertTrue(flag.set)
        awake.sync(.instructor, room, riderJoined: false, foreground: false)
        XCTAssertFalse(flag.set)
        awake.sync(.instructor, room, riderJoined: false, foreground: true)
        XCTAssertTrue(flag.set)
        awake.sync(.instructor, "/instructor.html", riderJoined: false, foreground: true)
        XCTAssertFalse(flag.set)
        // Rider: joined and in the foreground.
        awake.sync(.rider, "/rider.html", riderJoined: false, foreground: true)
        XCTAssertFalse(flag.set)
        awake.sync(.rider, "/rider.html", riderJoined: true, foreground: true)
        XCTAssertTrue(flag.set)
        awake.sync(.rider, "/rider.html", riderJoined: false, foreground: true)
        XCTAssertFalse(flag.set)
        awake.sync(.rider, "/rider.html", riderJoined: true, foreground: true)
        XCTAssertTrue(flag.set)
        awake.sync(nil, nil, riderJoined: true, foreground: true)
        XCTAssertFalse(flag.set)
    }

    func testReleaseClearsTheFlagWhateverThePolicyWouldSay() {
        let flag = FakeFlag()
        let awake = KeepAwake(flag)
        awake.sync(.rider, "/rider.html", riderJoined: true, foreground: true)
        XCTAssertTrue(flag.set)
        awake.release()
        XCTAssertFalse(flag.set)
    }
}
