import XCTest
@testable import App

// The pairing service on fakes (issue #896): the backend never leaves the process, the clock and
// the timer are moved by hand, and the pairing page goes to the ports (Safari), never to the app's
// web view.
final class PairingServiceTests: XCTestCase {
    private let origin = FakeBackend.origin

    func testPairingRunsThroughTheFixedCallsAndSavesTheRecord() {
        let rig = PairingRig()
        rig.service.begin()
        XCTAssertEqual(rig.service.view(), .starting)
        XCTAssertEqual(rig.backend.requests.map(\.description), ["POST /api/pairing/start"])
        XCTAssertEqual(rig.backend.requests[0].body, ["platform": "ios", "version": "1.0.0"])
        rig.backend.ok(FakeBackend.startBody())
        XCTAssertEqual(rig.service.view(), .waiting(userCode: "BCDF-GHJK", page: origin + "/pair", expiresAt: 601_000))
        XCTAssertEqual(rig.ports.timers.map { $0.at }, [6500])
        rig.ports.fireNext()
        XCTAssertEqual(rig.backend.requests.last?.body, ["device_code": Secrets.deviceCode()])
        XCTAssertNil(rig.backend.requests.last?.token)
        rig.backend.answerNext(.http(status: 400, body: ["error": PairingProtocol.pending], retryAfterS: nil))
        XCTAssertEqual(rig.ports.timers.map { $0.at }, [12_000])
        rig.ports.fireNext()
        rig.backend.ok(FakeBackend.tokenBody())

        XCTAssertTrue(rig.service.paired)
        XCTAssertEqual(rig.service.view(), .paired(email: "rider@classbeat.test", deviceName: nil, expired: false, notice: nil))
        let held = PairingRecord(origin: origin, token: Secrets.token(), email: "rider@classbeat.test")
        XCTAssertEqual(rig.store.text, held.text())
        XCTAssertEqual(rig.service.credential(), held)
        XCTAssertEqual(rig.backend.open, 0)
    }

    func testThePairingPageOpensThroughThePortsNeverTheAppsWebView() {
        let rig = PairingRig()
        rig.service.begin()
        XCTAssertEqual(rig.ports.pages, [])
        rig.backend.ok(FakeBackend.startBody())
        XCTAssertEqual(rig.ports.pages, [origin + "/pair"])
        // The page never carries the codes.
        XCTAssertFalse(rig.ports.pages[0].contains("BCDF"))
        XCTAssertFalse(rig.ports.pages[0].contains(Secrets.deviceCode()))
    }

    func testSecretsAreTheDeviceCodeWhileWaitingAndTheTokenOncePaired() {
        let rig = PairingRig()
        XCTAssertEqual(rig.service.secrets(), [])
        rig.toWaiting()
        XCTAssertEqual(rig.service.secrets(), [Secrets.deviceCode()])
        XCTAssertNil(rig.service.credential())
        rig.backend.ok(FakeBackend.tokenBody())
        XCTAssertEqual(rig.service.secrets(), [Secrets.token()])
        // Nothing the page may read holds either.
        let view = "\(rig.service.view())"
        XCTAssertFalse(view.contains(Secrets.token()))
        XCTAssertFalse(view.contains(Secrets.deviceCode()))
    }

    func testLoadHoldsAStoredRecordForThisBackendAndChecksIt() {
        let rig = PairingRig()
        rig.store.text = PairingRecord(origin: origin, token: Secrets.token(), email: nil).text()
        rig.service.load()
        XCTAssertTrue(rig.service.paired)
        XCTAssertEqual(rig.backend.requests.map(\.description), ["GET /api/player/device (with the device token)"])
        XCTAssertEqual(rig.backend.requests[0].token, Secrets.token())
        rig.backend.ok(["device": ["name": "Phone"]])
        XCTAssertEqual(rig.service.view(), .paired(email: nil, deviceName: "Phone", expired: false, notice: nil))
        XCTAssertEqual(rig.store.deletes, 0)
    }

    func testLoadDeletesARecordItCannotReadOrOneForAnotherBackend() {
        for text in ["not json", PairingRecord(origin: "https://other.test", token: Secrets.token(), email: nil).text()!] {
            let rig = PairingRig()
            rig.store.text = text
            rig.service.load()
            XCTAssertFalse(rig.service.paired)
            XCTAssertNil(rig.store.text)
            XCTAssertEqual(rig.store.deletes, 1)
            XCTAssertEqual(rig.ports.cacheForgets, 1)
            XCTAssertEqual(rig.backend.requests.count, 0)
        }
        // With no backend in the build, a stored record is never used.
        let rig = PairingRig(origin: nil)
        rig.store.text = PairingRecord(origin: origin, token: Secrets.token(), email: nil).text()
        rig.service.load()
        XCTAssertFalse(rig.service.paired)
        XCTAssertNil(rig.store.text)
    }

    func testNoKeychainMeansNoStartCall() {
        let rig = PairingRig()
        rig.store.isAvailable = false
        rig.service.begin()
        XCTAssertEqual(rig.backend.requests.count, 0)
        XCTAssertEqual(rig.service.view(), .unpaired(notice: .noKeychain))
        // A closed store is the same: it never pairs.
        let closed = PairingRig(store: ClosedSecretStore())
        closed.service.begin()
        XCTAssertEqual(closed.backend.requests.count, 0)
        XCTAssertEqual(closed.service.view(), .unpaired(notice: .noKeychain))
    }

    func testAFailedSaveUnpairsAndGivesTheTokenBack() {
        let rig = PairingRig()
        rig.store.saves = false
        var forgotten = 0
        rig.service.forgotten = { forgotten += 1 }
        rig.pair()
        XCTAssertFalse(rig.service.paired)
        XCTAssertEqual(rig.service.view(), .unpaired(notice: .saveFailed))
        XCTAssertEqual(rig.service.secrets(), [])
        XCTAssertNil(rig.store.text)
        XCTAssertEqual(forgotten, 1)
        XCTAssertEqual(rig.backend.requests.last?.description, "DELETE /api/player/device (with the device token)")
        XCTAssertEqual(rig.backend.requests.last?.token, Secrets.token())
    }

    func testUnpairDeletesTheTokenAndTheCacheAndClosesInstructorMode() {
        let rig = PairingRig()
        var forgotten = 0
        rig.service.forgotten = { forgotten += 1 }
        rig.pair()
        rig.service.unpair()
        XCTAssertFalse(rig.service.paired)
        XCTAssertNil(rig.store.text)
        XCTAssertEqual(rig.ports.cacheForgets, 1)
        XCTAssertEqual(forgotten, 1)
        XCTAssertEqual(rig.backend.requests.last?.description, "DELETE /api/player/device (with the device token)")
    }

    func testARevokedTokenIsForgottenAndAnExpiredOneKept() {
        let rig = PairingRig()
        var forgotten = 0
        rig.service.forgotten = { forgotten += 1 }
        rig.pair()
        rig.service.refused(.expired)
        XCTAssertEqual(rig.service.view(), .paired(email: "rider@classbeat.test", deviceName: nil, expired: true, notice: nil))
        XCTAssertTrue(rig.service.paired)
        XCTAssertNil(rig.service.credential())
        rig.service.refused(.gone)
        XCTAssertEqual(rig.service.view(), .unpaired(notice: .revokedOnSite))
        XCTAssertNil(rig.store.text)
        XCTAssertEqual(forgotten, 1)
    }

    func testCancelStopsTheAttemptAndALateTokenIsGivenBackNotKept() {
        let rig = PairingRig()
        rig.toWaiting()
        rig.service.cancel()
        XCTAssertEqual(rig.service.view(), .unpaired(notice: nil))
        rig.backend.ok(FakeBackend.tokenBody())
        XCTAssertFalse(rig.service.paired)
        XCTAssertNil(rig.store.text)
        XCTAssertEqual(rig.backend.requests.last?.description, "DELETE /api/player/device (with the device token)")
        // Cancel never ends a pairing held.
        let held = PairingRig()
        held.pair()
        held.service.cancel()
        XCTAssertTrue(held.service.paired)
    }

    func testTheOfflineTransportAnswersUnreachableOnALaterTurn() {
        var posted: [() -> Void] = []
        let store = FakeStore()
        let service = PairingService(
            origin: origin, allowLoopbackHttp: false, version: "1", transport: OfflineTransport { posted.append($0) },
            store: store, ports: FakePorts()
        )
        service.begin()
        XCTAssertEqual(service.view(), .starting)
        XCTAssertEqual(posted.count, 1)
        posted.removeFirst()()
        XCTAssertEqual(service.view(), .unpaired(notice: .unreachable))
        XCTAssertNil(store.text)
    }

    /// Issue #925: in the background the phone asks the server nothing; back in front it asks at once.
    func testNothingIsAskedInTheBackgroundAndTheServerIsAskedAtOnceOnReturn() {
        let rig = PairingRig()
        rig.toWaiting()
        rig.service.stopped()
        // The poll in flight answers "pending" in the background: no wake is set.
        rig.backend.answerNext(.http(status: 400, body: ["error": PairingProtocol.pending], retryAfterS: nil))
        XCTAssertTrue(rig.ports.timers.isEmpty)
        let asked = rig.backend.requests.count
        rig.service.resumed()
        XCTAssertEqual(rig.backend.requests.count, asked + 1, "asked at once on return")
        XCTAssertEqual(rig.backend.requests.last?.body, ["device_code": Secrets.deviceCode()])
        rig.backend.ok(FakeBackend.tokenBody())
        XCTAssertTrue(rig.service.paired)
    }

    func testAWakeSetBeforeTheBackgroundDoesNothing() {
        let rig = PairingRig()
        rig.toWaiting()
        rig.backend.answerNext(.http(status: 400, body: ["error": PairingProtocol.pending], retryAfterS: nil))
        XCTAssertEqual(rig.ports.timers.count, 1)
        rig.service.stopped()
        let asked = rig.backend.requests.count
        rig.ports.fireNext()
        XCTAssertEqual(rig.backend.requests.count, asked, "a stale wake asks nothing")
        rig.service.resumed()
        XCTAssertEqual(rig.backend.requests.count, asked + 1)
        // A second return while that poll is out asks nothing more.
        rig.service.stopped()
        rig.service.resumed()
        XCTAssertEqual(rig.backend.requests.count, asked + 1)
    }

    func testResumingWithNoCodeWaitingAsksNothing() {
        let rig = PairingRig()
        rig.service.stopped()
        rig.service.resumed()
        rig.pair()
        let asked = rig.backend.requests.count
        rig.service.stopped()
        rig.service.resumed()
        XCTAssertEqual(rig.backend.requests.count, asked)
    }

    func testTheShippedBuildHasNoBackendSoItNeverPairs() {
        let rig = PairingRig(origin: nil)
        rig.service.begin()
        XCTAssertEqual(rig.backend.requests.count, 0)
        XCTAssertEqual(rig.service.view(), .unpaired(notice: .noServer))
    }
}
