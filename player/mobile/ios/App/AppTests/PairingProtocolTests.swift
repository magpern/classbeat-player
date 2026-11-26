import XCTest
@testable import App

// The backend's answers read strictly, the fixed origin and calls, and the stored record (issue
// #896): the twins of Android's PairingProtocolTest.kt, OriginPolicyTest.kt and CallsTest.kt.
final class PairingProtocolTests: XCTestCase {
    private let origin = "https://classbeat.test"

    private func ok(_ body: Any?) -> HttpAnswer { .http(status: 200, body: body, retryAfterS: nil) }

    private func startBody(_ change: (inout [String: Any]) -> Void = { _ in }) -> [String: Any] {
        var b = FakeBackend.startBody()
        change(&b)
        return b
    }

    func testAStartAnswerIsReadStrictly() {
        XCTAssertEqual(
            PairingProtocol.parseStart(ok(startBody()), origin),
            .started(deviceCode: Secrets.deviceCode(), userCode: "BCDF-GHJK", page: origin + "/pair", expiresInMs: 600_000, intervalMs: 5000)
        )
        // Never faster than five seconds.
        if case let .started(_, _, _, _, interval) = PairingProtocol.parseStart(ok(startBody { $0["interval"] = 1 }), origin) {
            XCTAssertEqual(interval, 5000)
        } else {
            XCTFail("a one-second interval is read as five")
        }
        let bad: [(inout [String: Any]) -> Void] = [
            { $0["device_code"] = "cbp_dc_short" },
            { $0["device_code"] = Secrets.token() },
            { $0["user_code"] = "AAAA-AAAA" },
            { $0["user_code"] = nil },
            { $0["verification_uri"] = "https://elsewhere.test/pair" },
            { $0["verification_uri"] = self.origin + "/pair?code=BCDF-GHJK" },
            { $0["expires_in"] = 0 },
            { $0["expires_in"] = 3601 },
            { $0["expires_in"] = 1.5 },
            { $0["expires_in"] = true },
            { $0["interval"] = 61 },
            { $0["interval"] = "5" },
            { $0["interval"] = NSNull() },
        ]
        for change in bad {
            XCTAssertEqual(PairingProtocol.parseStart(ok(startBody(change)), origin), .unexpected)
        }
        XCTAssertEqual(PairingProtocol.parseStart(ok([1, 2]), origin), .unexpected)
        XCTAssertEqual(PairingProtocol.parseStart(.http(status: 429, body: nil, retryAfterS: 3), origin), .tooMany)
        XCTAssertEqual(PairingProtocol.parseStart(.http(status: 503, body: nil, retryAfterS: nil), origin), .unreachable)
        XCTAssertEqual(PairingProtocol.parseStart(.http(status: 404, body: nil, retryAfterS: nil), origin), .unexpected)
        XCTAssertEqual(PairingProtocol.parseStart(.unreachable, origin), .unreachable)
    }

    func testAPollAnswerIsReadStrictly() {
        XCTAssertEqual(PairingProtocol.parsePoll(ok(FakeBackend.tokenBody())), .ok(token: Secrets.token(), email: "rider@classbeat.test"))
        XCTAssertEqual(PairingProtocol.parsePoll(ok(FakeBackend.tokenBody(email: NSNull()))), .ok(token: Secrets.token(), email: nil))
        XCTAssertEqual(PairingProtocol.parsePoll(ok(FakeBackend.tokenBody(email: " a@b.test\u{200B} "))), .ok(token: Secrets.token(), email: "a@b.test"))
        XCTAssertEqual(PairingProtocol.parsePoll(ok(["device_token": Secrets.token()])), .unexpected)
        XCTAssertEqual(PairingProtocol.parsePoll(ok(FakeBackend.tokenBody(email: ""))), .unexpected)
        XCTAssertEqual(PairingProtocol.parsePoll(ok(FakeBackend.tokenBody(email: 5))), .unexpected)
        XCTAssertEqual(PairingProtocol.parsePoll(ok(FakeBackend.tokenBody(Secrets.deviceCode()))), .unexpected)
        XCTAssertEqual(PairingProtocol.parsePoll(ok(FakeBackend.tokenBody(Secrets.token() + "A"))), .unexpected)
        for code in [PairingProtocol.pending, PairingProtocol.slowDown, PairingProtocol.denied, PairingProtocol.expired] {
            XCTAssertEqual(PairingProtocol.parsePoll(.http(status: 400, body: ["error": code], retryAfterS: nil)), .refused(code))
        }
        XCTAssertEqual(PairingProtocol.parsePoll(.http(status: 400, body: ["error": "other"], retryAfterS: nil)), .unexpected)
        XCTAssertEqual(PairingProtocol.parsePoll(.http(status: 429, body: nil, retryAfterS: 7)), .retry(afterMs: 7000))
        XCTAssertEqual(PairingProtocol.parsePoll(.http(status: 500, body: nil, retryAfterS: nil)), .retry(afterMs: nil))
        XCTAssertEqual(PairingProtocol.parsePoll(.unreachable), .retry(afterMs: nil))
        XCTAssertEqual(PairingProtocol.parsePoll(.http(status: 401, body: nil, retryAfterS: nil)), .unexpected)
    }

    func testATokenRefusalAndTheDeviceCheck() {
        let refused = { (e: String) in HttpAnswer.http(status: 401, body: ["error": e], retryAfterS: nil) }
        XCTAssertEqual(PairingProtocol.tokenRefusal(refused("token_revoked")), .gone)
        XCTAssertEqual(PairingProtocol.tokenRefusal(refused("token_unknown")), .gone)
        XCTAssertEqual(PairingProtocol.tokenRefusal(refused("token_expired")), .expired)
        XCTAssertNil(PairingProtocol.tokenRefusal(refused("other")))
        XCTAssertNil(PairingProtocol.tokenRefusal(.http(status: 403, body: ["error": "token_revoked"], retryAfterS: nil)))
        XCTAssertEqual(PairingProtocol.parseDevice(ok(["device": ["name": "Phone"]])), .ok(name: "Phone"))
        XCTAssertEqual(PairingProtocol.parseDevice(ok(["device": ["name": String(repeating: "x", count: 41)]])), .unknown)
        XCTAssertEqual(PairingProtocol.parseDevice(refused("token_revoked")), .gone)
        XCTAssertEqual(PairingProtocol.parseDevice(refused("token_expired")), .expired)
        XCTAssertEqual(PairingProtocol.parseDevice(.unreachable), .unknown)
        XCTAssertEqual(PairingProtocol.parseDevice(.http(status: 500, body: nil, retryAfterS: nil)), .unknown)
    }

    func testTheBackendOriginIsHttpsOrLoopbackHttpInADebugBuild() {
        XCTAssertEqual(OriginPolicy.parseBackendOrigin("https://classbeat.test/", allowLoopbackHttp: false), origin)
        XCTAssertEqual(OriginPolicy.parseBackendOrigin("https://classbeat.test:8443", allowLoopbackHttp: false), "https://classbeat.test:8443")
        XCTAssertEqual(OriginPolicy.parseBackendOrigin("http://127.0.0.1:8000", allowLoopbackHttp: true), "http://127.0.0.1:8000")
        XCTAssertEqual(OriginPolicy.parseBackendOrigin("http://[::1]:8000", allowLoopbackHttp: true), "http://[::1]:8000")
        for raw in [
            nil, "", "http://127.0.0.1:8000", "http://classbeat.test", "https://Classbeat.test", "https://classbeat.test:443",
            "https://classbeat.test:0", "https://classbeat.test:70000", "https://classbeat.test/api", "https://user@classbeat.test",
            "https://classbeat.test?x=1", "ftp://classbeat.test",
        ] {
            XCTAssertNil(OriginPolicy.parseBackendOrigin(raw, allowLoopbackHttp: false), raw ?? "nil")
        }
        XCTAssertNil(OriginPolicy.parseBackendOrigin("http://classbeat.test", allowLoopbackHttp: true))
    }

    func testThePairingPageIsOnTheBackendWithNoQuery() {
        XCTAssertEqual(OriginPolicy.pairingPageOn(origin, origin + "/pair"), origin + "/pair")
        let uris: [Any?] = [
            nil, 5, origin, origin + "/pair?code=X", origin + "/pair#x", origin + "/a//b", origin + "/a/../b", origin + ".evil.test/pair",
            "https://other.test/pair", origin + "/" + String(repeating: "a", count: 200),
        ]
        for uri in uris {
            XCTAssertNil(OriginPolicy.pairingPageOn(origin, uri), "\(String(describing: uri))")
        }
    }

    func testOnlyTheFixedCallsGoAndTheTokenOnlyOnThePlayerCalls() {
        let t = Secrets.token()
        let id = "0f8fad5b-d9cb-469f-a165-70867728950e"
        let made: [BackendRequest] = [
            Calls.pairingStart(origin, "1.0.0"), Calls.pairingToken(origin, Secrets.deviceCode()), Calls.device(origin, t),
            Calls.revoke(origin, t), Calls.changes(origin, t, after: 0)!, Calls.classDocument(origin, t, id)!,
        ]
        for r in made {
            XCTAssertEqual(TransportContract.address(r, buildOrigin: origin), origin + r.path)
        }
        XCTAssertEqual(Calls.pairingStart(origin, "1.0.0").body, ["platform": "ios", "version": "1.0.0"])
        XCTAssertNil(Calls.changes(origin, t, after: -1))
        XCTAssertNil(Calls.classDocument(origin, t, "../device"))
        XCTAssertNil(TransportContract.address(Calls.device(origin, t), buildOrigin: "https://other.test"))
        XCTAssertNil(TransportContract.address(BackendRequest(origin, .get, "/api/player/device"), buildOrigin: origin))
        XCTAssertNil(TransportContract.address(BackendRequest(origin, .post, "/api/pairing/start", token: t), buildOrigin: origin))
        XCTAssertNil(TransportContract.address(BackendRequest(origin, .get, "/api/account", token: t), buildOrigin: origin))
        XCTAssertNil(TransportContract.address(BackendRequest(origin, .get, "/api/player/device", token: t, maxBodyBytes: 0), buildOrigin: origin))
        XCTAssertEqual(TransportContract.headers(Calls.device(origin, t)), ["Accept": "application/json", "Authorization": "Bearer " + t])
        XCTAssertEqual(
            TransportContract.headers(Calls.pairingStart(origin, "1")),
            ["Accept": "application/json", "Content-Type": "application/json"]
        )
    }

    func testTheRecordRoundTripsAndRefusesAnythingElse() {
        let record = PairingRecord(origin: origin, token: Secrets.token(), email: nil)
        guard let text = record.text() else { return XCTFail("no text") }
        XCTAssertEqual(PairingRecord.parse(text, allowLoopbackHttp: false), record)
        let withEmail = PairingRecord(origin: origin, token: Secrets.token(), email: "rider@classbeat.test")
        XCTAssertEqual(withEmail.text().flatMap { PairingRecord.parse($0, allowLoopbackHttp: false) }, withEmail)
        for bad in [
            "", "[]", "{\"v\":1}", "{\"v\":true,\"origin\":\"\(origin)\",\"token\":\"\(Secrets.token())\",\"email\":null}",
            "{\"v\":2,\"origin\":\"\(origin)\",\"token\":\"\(Secrets.token())\",\"email\":null}",
            "{\"v\":1,\"origin\":\"http://\(origin.dropFirst(8))\",\"token\":\"\(Secrets.token())\",\"email\":null}",
            "{\"v\":1,\"origin\":\"\(origin)\",\"token\":\"\(Secrets.deviceCode())\",\"email\":null}",
            "{\"v\":1,\"origin\":\"\(origin)\",\"token\":\"\(Secrets.token())\"}",
        ] {
            XCTAssertNil(PairingRecord.parse(bad, allowLoopbackHttp: true), bad.count > 20 ? "record" : bad)
        }
    }
}
