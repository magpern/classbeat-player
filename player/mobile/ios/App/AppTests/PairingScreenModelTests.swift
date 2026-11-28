import XCTest
@testable import App

// What the native pairing screen says in each state (issue #925, docs/design/app-pairing-ios.md).
final class PairingScreenModelTests: XCTestCase {
    private typealias M = PairingScreenModel
    private let page = "https://classbeat.test/pair"

    private func words(_ screen: M.Screen) -> [String] { screen.lines.map { $0.words } }
    private func labels(_ screen: M.Screen) -> [String] { screen.keys.map { $0.label } }

    func testAskingForACode() {
        for view in [PairingView.starting, .unpaired(notice: nil), .unpaired(notice: .unpaired)] {
            let screen = M.screen(view, now: 0, returned: false, instructor: false)
            XCTAssertEqual(words(screen), ["●  Instructor mode", "Pair this phone", "○  Asking the server for a code"])
            XCTAssertEqual(labels(screen), ["Cancel"])
        }
    }

    func testTheCodeWithItsCountdownAndSteps() {
        let view = PairingView.waiting(userCode: "BCDF-GHJK", page: page, expiresAt: 600_000)
        let screen = M.screen(view, now: 0, returned: false, instructor: false)
        XCTAssertEqual(words(screen), [
            "●  Instructor mode", "Pair this phone", "BCDF-GHJK", "The code runs out in 10:00",
            "1.  Open " + page + ": the button below opens it in your browser", "2.  Sign in and type the code.", "3.  Confirm only if this phone shows the same code.",
        ])
        XCTAssertEqual(screen.act.count, 3, "the steps go with the keys")
        XCTAssertEqual(screen.keys, [M.Key(label: "Open the site", main: true, action: .open), M.Key(label: "Cancel", main: false, action: .cancel)])
    }

    func testBackFromSafariTheCodeSaysItIsNotYetConfirmed() {
        let view = PairingView.waiting(userCode: "BCDF-GHJK", page: page, expiresAt: 600_000)
        let screen = M.screen(view, now: 1, returned: true, instructor: false)
        XCTAssertEqual(screen.lead[2], .working("Not yet confirmed on the website"))
        XCTAssertEqual(labels(screen), ["Open the page again", "Cancel"])
    }

    func testTheCountdownRoundsUpAndStopsAtZero() {
        XCTAssertEqual(M.left(600_000, 0), "10:00")
        XCTAssertEqual(M.left(61_000, 1), "1:01")
        XCTAssertEqual(M.left(9_001, 0), "0:10")
        XCTAssertEqual(M.left(1_000, 0), "0:01")
        XCTAssertEqual(M.left(0, 5_000), "0:00")
    }

    func testPairedAsksForTheLockOnlyFromRiderMode() {
        let view = PairingView.paired(email: "rider@classbeat.test", deviceName: nil, expired: false, notice: nil)
        let rider = M.screen(view, now: 0, returned: false, instructor: false)
        XCTAssertEqual(words(rider), ["●  Instructor mode", "This phone is paired", "Paired as rider@classbeat.test", "Confirm it is you to open instructor mode."])
        XCTAssertEqual(rider.keys, [M.Key(label: "Continue", main: true, action: .proceed)])
        let again = M.screen(view, now: 0, returned: false, instructor: true)
        XCTAssertEqual(words(again), ["●  Instructor mode", "This phone is paired", "Paired as rider@classbeat.test"])
    }

    func testAnExpiredPairingAsksForANewCode() {
        let view = PairingView.paired(email: nil, deviceName: nil, expired: true, notice: nil)
        XCTAssertEqual(labels(M.screen(view, now: 0, returned: false, instructor: true)), ["Cancel"])
    }

    /// With no passcode the Keychain refuses the token: no pairing, and "Start again" is offered.
    func testNoPasscodeOffersStartAgain() {
        let screen = M.screen(.unpaired(notice: .noKeychain), now: 0, returned: false, instructor: false)
        XCTAssertEqual(screen.lead.last, .plate(
            head: "This phone cannot be paired.",
            body: "Pairing needs a passcode to keep it safe. Set one in Settings, then start again. Rider mode works without it."
        ))
        XCTAssertEqual(screen.keys, [M.Key(label: "Start again", main: true, action: .startAgain), M.Key(label: "Rider mode", main: false, action: .rider)])
    }

    func testEveryNoticeHasAPlateWithStartAgain() {
        let notices: [PairingMachine.Notice] = [.noServer, .noKeychain, .tooMany, .unreachable, .unexpected, .denied, .codeExpired, .saveFailed, .revokedOnSite]
        for notice in notices {
            for view in [PairingView.unpaired(notice: notice), .paired(email: nil, deviceName: nil, expired: true, notice: notice)] {
                let screen = M.screen(view, now: 0, returned: false, instructor: true)
                guard case let .plate(head, body)? = screen.lead.last else { return XCTFail("\(notice)") }
                XCTAssertFalse(head.isEmpty || body.isEmpty)
                XCTAssertEqual(labels(screen), ["Start again", "Rider mode"], "\(notice)")
            }
        }
        XCTAssertEqual(M.screen(.unpaired(notice: .denied), now: 0, returned: false, instructor: false).lead.last,
                       .plate(head: "Refused on the website.", body: "Nothing was kept on this phone."))
    }

    func testOnlyANoticeHoldsTheScreenBeforeAPairingBegins() {
        XCTAssertTrue(M.begins(.unpaired(notice: nil)))
        XCTAssertTrue(M.begins(.unpaired(notice: .unpaired)))
        XCTAssertTrue(M.begins(.paired(email: nil, deviceName: nil, expired: true, notice: nil)))
        XCTAssertFalse(M.begins(.unpaired(notice: .noKeychain)))
        XCTAssertFalse(M.begins(.unpaired(notice: .revokedOnSite)))
    }
}
