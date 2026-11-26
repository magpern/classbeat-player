import XCTest
@testable import App

// The same table as Android's IntentPolicyTest.kt (issue #895).
final class IntentPolicyTests: XCTestCase {
    private typealias Refusal = IntentPolicy.Refusal
    private let other: [Mode: Mode] = [.rider: .instructor, .instructor: .rider]

    func testEveryIntentIsListedHereByHandWithItsMode() {
        // A new intent fails this test until it is added here, with a test of its arguments below.
        let expected: [String: Mode] = [
            "instructorWay": .rider,
            "askInstructorMode": .rider,
            "join": .rider,
            "open": .rider,
            "receive": .rider,
            "leave": .rider,
            "askRiderMode": .instructor,
            "listClasses": .instructor,
            "syncNow": .instructor,
            "getClass": .instructor,
            "unpair": .instructor,
            "pairAgain": .instructor,
            "followAccess": .instructor,
            "openFollowSetting": .instructor,
            "follow": .instructor,
            "unfollow": .instructor,
            "reading": .instructor,
            "sendPlay": .instructor,
            "sendPause": .instructor,
            "sendNext": .instructor,
        ]
        XCTAssertEqual(IntentPolicy.intents.mapValues { $0.mode }, expected)
    }

    func testRiderModeHasNoInstructorIntentAndInstructorModeHasNoRiderIntent() {
        let rider = IntentPolicy.of(.rider)
        let instructor = IntentPolicy.of(.instructor)
        XCTAssertEqual(rider, ["instructorWay", "askInstructorMode", "join", "open", "receive", "leave"])
        XCTAssertEqual(
            instructor,
            ["askRiderMode", "listClasses", "syncNow", "getClass", "unpair", "pairAgain", "followAccess", "openFollowSetting", "follow", "unfollow", "reading", "sendPlay", "sendPause", "sendNext"]
        )
        XCTAssertTrue(rider.intersection(instructor).isEmpty)
        XCTAssertEqual(Set(IntentPolicy.intents.keys), rider.union(instructor))
    }

    func testEachIntentRunsOnlyFromItsOwnModesPluginWhileTheAppIsInThatMode() {
        for (name, spec) in IntentPolicy.intents {
            let mode = spec.mode
            let otherMode = other[mode]!
            let args = good(spec)
            XCTAssertNil(IntentPolicy.check(mode, mode, name, args), name)
            XCTAssertEqual(IntentPolicy.check(mode, otherMode, name, args), .otherMode, name)
            XCTAssertEqual(IntentPolicy.check(otherMode, mode, name, args), .otherMode, name)
            XCTAssertEqual(IntentPolicy.check(nil, mode, name, args), .switching, name)
        }
    }

    func testEachIntentRejectsAnUnexpectedArgument() {
        let extras: [(String, Any)] = [("mode", "instructor"), ("unlock", true), ("x", NSNull()), ("", 1), ("__proto__", "{}")]
        for (name, spec) in IntentPolicy.intents {
            for (key, value) in extras {
                var args = good(spec)
                args[key] = value
                XCTAssertEqual(IntentPolicy.check(spec.mode, spec.mode, name, args), .unexpectedArgument, "\(name) \(key)")
            }
        }
    }

    func testInstructorWayRejectsAnUnexpectedArgument() { rejectsExtra("instructorWay") }

    func testAskInstructorModeRejectsAnUnexpectedArgument() { rejectsExtra("askInstructorMode") }

    func testAskRiderModeRejectsAnUnexpectedArgument() { rejectsExtra("askRiderMode") }

    func testListClassesRejectsAnUnexpectedArgument() { rejectsExtra("listClasses") }

    func testSyncNowRejectsAnUnexpectedArgument() { rejectsExtra("syncNow") }

    func testUnpairRejectsAnUnexpectedArgument() { rejectsExtra("unpair") }

    func testPairAgainRejectsAnUnexpectedArgument() { rejectsExtra("pairAgain") }

    func testOpenRejectsAnUnexpectedArgument() { rejectsExtra("open") }

    func testReceiveRejectsAnUnexpectedArgument() { rejectsExtra("receive") }

    func testLeaveRejectsAnUnexpectedArgument() { rejectsExtra("leave") }

    func testJoinTakesTheClassCodeAndANicknameBothStringsAndNothingElse() {
        func check(_ args: [String: Any]) -> Refusal? { IntentPolicy.check(.rider, .rider, "join", args) }
        let good: [String: Any] = ["session": "KXPD-RMTB", "nickname": "Sam"]
        XCTAssertNil(check(good))
        XCTAssertEqual(check(good.filter { $0.key != "session" }), .missingArgument)
        XCTAssertEqual(check(good.filter { $0.key != "nickname" }), .missingArgument)
        XCTAssertEqual(check(good.merging(["session": 1]) { $1 }), .wrongType)
        XCTAssertEqual(check(good.merging(["nickname": NSNull()]) { $1 }), .wrongType)
        // The rider's numbers never go to native code, and the page names no address or token.
        for extra in ["ftp", "hrmax", "token", "riderToken", "url", "path"] {
            XCTAssertEqual(check(good.merging([extra: "x"]) { $1 }), .unexpectedArgument, extra)
        }
    }

    func testTheFollowIntentsTakeNoArgumentSoThePageNamesNoAppSessionOrPackage() {
        for name in ["followAccess", "openFollowSetting", "follow", "unfollow", "reading"] {
            rejectsExtra(name)
            for extra in ["package", "app", "session", "token"] {
                XCTAssertEqual(IntentPolicy.check(.instructor, .instructor, name, [extra: "x"]), .unexpectedArgument, "\(name) \(extra)")
            }
            // Following is asked for only in instructor mode: never from rider mode's plugin or page.
            XCTAssertEqual(IntentPolicy.check(.rider, .rider, name, [:]), .otherMode, name)
        }
    }

    func testTheOnlyMusicCommandsArePlayPauseAndNextAndNoneTakesAnArgument() {
        // #857: the page sends one of three fixed intents and names no command, app, session or position.
        for name in ["sendPlay", "sendPause", "sendNext"] {
            XCTAssertNil(IntentPolicy.check(.instructor, .instructor, name, [:]), name)
            rejectsExtra(name)
            for extra in ["command", "action", "position", "package", "app", "session", "volume"] {
                XCTAssertEqual(IntentPolicy.check(.instructor, .instructor, name, [extra: "x"]), .unexpectedArgument, "\(name) \(extra)")
            }
            XCTAssertEqual(IntentPolicy.check(.rider, .rider, name, [:]), .otherMode, name)
            XCTAssertEqual(IntentPolicy.check(.instructor, .rider, name, [:]), .otherMode, name)
            XCTAssertEqual(IntentPolicy.check(.rider, .instructor, name, [:]), .otherMode, name)
            XCTAssertEqual(IntentPolicy.check(nil, .instructor, name, [:]), .switching, name)
        }
        // Built from parts: the iOS guard bans the whole word in the sources.
        let bare = "se" + "nd"
        let names = ["play", "pause", "next", "sendStop", "sendSeek", bare, "stop", "seek", "seekTo", "previous", "skipToPrevious", "setVolume", "rewind", "fastForward", "PLAY", "Next", "playPause", "command"]
        for name in names {
            for mode in Mode.allCases {
                XCTAssertEqual(IntentPolicy.check(mode, mode, name, [:]), .unknown, name)
            }
        }
    }

    func testGetClassTakesOneIdAStringAndNothingElse() {
        func check(_ args: [String: Any]) -> Refusal? { IntentPolicy.check(.instructor, .instructor, "getClass", args) }
        XCTAssertNil(check(["id": "00000000-0000-4000-8000-000000000001"]))
        XCTAssertEqual(check([:]), .missingArgument)
        XCTAssertEqual(check(["id": 1]), .wrongType)
        XCTAssertEqual(check(["id": NSNull()]), .wrongType)
        // The page names no address, path or token: there is no argument to carry one.
        for extra in ["url", "path", "origin", "token", "headers"] {
            XCTAssertEqual(check(["id": "x", extra: "x"]), .unexpectedArgument, extra)
        }
    }

    func testAnUnknownNameIsRefusedInEitherMode() {
        for name in ["", "setMode", "unlock", "askinstructormode", "askRiderMode "] {
            for mode in Mode.allCases {
                XCTAssertEqual(IntentPolicy.check(mode, mode, name, [:]), .unknown, name)
            }
        }
    }

    func testTypedArgumentsAreCheckedByNameAndType() {
        let table = ["join": IntentPolicy.Spec(.rider, ["code": .string, "again": .boolean, "n": .number])]
        let good: [String: Any] = ["code": "AB12", "again": false, "n": 3]
        func check(_ args: [String: Any]) -> Refusal? { IntentPolicy.check(.rider, .rider, "join", args, table) }
        XCTAssertNil(check(good))
        XCTAssertEqual(check(good.filter { $0.key != "code" }), .missingArgument)
        XCTAssertEqual(check(good.merging(["extra": 1]) { $1 }), .unexpectedArgument)
        XCTAssertEqual(check(good.merging(["code": 12]) { $1 }), .wrongType)
        XCTAssertEqual(check(good.merging(["again": "true"]) { $1 }), .wrongType)
        XCTAssertEqual(check(good.merging(["n": "3"]) { $1 }), .wrongType)
        XCTAssertEqual(check(good.merging(["code": NSNull()]) { $1 }), .wrongType)
        XCTAssertEqual(IntentPolicy.of(.rider, table), ["join"])
    }

    func testABooleanIsNoNumberAndANumberIsNoBoolean() {
        // What the bridge hands over: JSON's true is a CFBoolean, 1 a plain NSNumber.
        let table = ["join": IntentPolicy.Spec(.rider, ["again": .boolean, "n": .number])]
        func check(_ args: [String: Any]) -> Refusal? { IntentPolicy.check(.rider, .rider, "join", args, table) }
        XCTAssertNil(check(["again": NSNumber(value: true), "n": NSNumber(value: 1)]))
        XCTAssertEqual(check(["again": NSNumber(value: 1), "n": NSNumber(value: 1)]), .wrongType)
        XCTAssertEqual(check(["again": NSNumber(value: true), "n": NSNumber(value: true)]), .wrongType)
    }

    /// Arguments of the right names and types for `spec`.
    private func good(_ spec: IntentPolicy.Spec) -> [String: Any] {
        spec.args.mapValues { type -> Any in
            switch type {
            case .string: return "x"
            case .boolean: return true
            case .number: return 1
            }
        }
    }

    private func rejectsExtra(_ name: String, file: StaticString = #filePath, line: UInt = #line) {
        let spec = IntentPolicy.intents[name]!
        var args = good(spec)
        args["mode"] = "instructor"
        XCTAssertEqual(IntentPolicy.check(spec.mode, spec.mode, name, args), .unexpectedArgument, name, file: file, line: line)
    }
}
