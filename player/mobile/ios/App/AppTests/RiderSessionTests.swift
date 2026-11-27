import XCTest
@testable import App

/// The rider's session against a fake transport (issue #898), with the cases of Android's
/// RiderSessionTest.kt. Nothing here touches a network.
final class RiderSessionTests: XCTestCase {
    private let token = RiderFixtures.token
    private var transport: FakeRiderTransport!
    private var session: RiderSession!

    /// Everything the page was given, written out: an answer or an event, or "refused".
    private var toPage: [String] = []
    private var reply: RiderReply!

    override func setUp() {
        super.setUp()
        transport = FakeRiderTransport()
        session = RiderSession(transport: transport)
        toPage = []
        reply = { [unowned self] data in self.toPage.append(RiderFixtures.written(data)) }
    }

    private func joined(file: StaticString = #filePath, line: UInt = #line) {
        session.join("KXPD-RMTB", "Sam", reply)
        transport.answerJoin(RiderFixtures.joinedAnswer)
        XCTAssertTrue(session.joined, file: file, line: line)
    }

    private func opened() -> FakeRiderTransport.Link {
        session.open(reply)
        let link = transport.links.last!
        link.events.opened()
        return link
    }

    /// Reads every event that waits, until the one refused word (the session is over).
    private func drain() {
        while true {
            let before = toPage.count
            session.receive(reply)
            if toPage.count == before || toPage.last == "refused" { return }
        }
    }

    private func example(_ name: String) -> String {
        RiderExamples.text(name)
    }

    /// No answer or event the page got holds the token, or any part of it long enough to matter.
    private func assertTokenNeverReachedThePage(file: StaticString = #filePath, line: UInt = #line) {
        let chars = Array(token)
        for sent in toPage {
            for i in 0...(chars.count - 12) {
                XCTAssertFalse(sent.contains(String(chars[i..<(i + 12)])), sent, file: file, line: line)
            }
        }
    }

    func testTheTokenFromTheJoinStaysNativeAndHelloCarriesItTheWayTheContractHasIt() throws {
        joined()
        let link = opened()
        XCTAssertEqual(link.sent.count, 1)
        let shape = try XCTUnwrap(RiderFixtures.object(example("hello/rdr-token.json")))
        let sent = try XCTUnwrap(RiderFixtures.object(link.sent[0]))
        XCTAssertEqual(Set(shape.keys), Set(sent.keys))
        XCTAssertEqual(sent["v"] as? Int, 1)
        XCTAssertEqual(sent["type"] as? String, "hello")
        XCTAssertEqual(sent["token"] as? String, token)
        XCTAssertEqual(toPage, [#"{"result":"joined"}"#, #"{"result":"opening"}"#])
        assertTokenNeverReachedThePage()
    }

    func testTheTokenNeverReachesThePageWhateverComesIn() {
        joined()
        let link = opened()
        // A frame that echoes the token (no real server puts one out) is dropped, not passed on.
        link.events.text(#"{"v":1,"type":"host_status","connected":true,"note":"\#(token)"}"#)
        link.events.text(example("welcome-rider/host-in.json"))
        for _ in 0..<4 { session.receive(reply) }
        assertTokenNeverReachedThePage()
        XCTAssertTrue(toPage.contains { $0.contains("welcome") })
        XCTAssertEqual(session.secrets, [token])
    }

    func testAJoinAnswerOtherThanAGoodTokenGivesThePageOnlyTheStatusAndTheErrorWord() {
        let answers: [(HttpAnswer, String)] = [
            (.unreachable, #"{"result":"unreachable"}"#),
            (.http(status: 404, body: ["error": "cannot_join"], retryAfterS: nil), #"{"body":{"error":"cannot_join"},"result":"answer","status":404}"#),
            (.http(status: 200, body: ["riderToken": "cbp_rdr_short"], retryAfterS: nil), #"{"body":null,"result":"answer","status":200}"#),
            (.http(status: 200, body: ["riderToken": token, "x": 1] as [String: Any], retryAfterS: nil), #"{"body":null,"result":"answer","status":200}"#),
            (.http(status: 500, body: ["error": "x", "trace": "y"], retryAfterS: nil), #"{"body":null,"result":"answer","status":500}"#),
            (.http(status: 429, body: ["error": "Too Many"], retryAfterS: 3), #"{"body":null,"result":"answer","status":429}"#),
            (.http(status: 403, body: nil, retryAfterS: nil), #"{"body":null,"result":"answer","status":403}"#),
        ]
        for (answer, expected) in answers {
            toPage = []
            session.join("KXPD-RMTB", "Sam", reply)
            transport.answerJoin(answer)
            XCTAssertEqual(toPage, [expected])
            XCTAssertFalse(session.joined)
        }
    }

    func testAJoinWithACodeOrNicknameOfTheWrongFormOrWhileJoinedIsRefusedAndNothingGoesOut() {
        let wrong = [
            ("kxpd-rmtb", "Sam"), ("KXPDRMTB", "Sam"), ("KXPD-RMTA", "Sam"), ("KXPD-RMTB ", "Sam"),
            ("KXPD-RMTB", ""), ("KXPD-RMTB", " Sam"), ("KXPD-RMTB", "   "), ("KXPD-RMTB", String(repeating: "x", count: 25)),
        ]
        for (code, nick) in wrong { session.join(code, nick, reply) }
        XCTAssertEqual(toPage, Array(repeating: "refused", count: wrong.count))
        XCTAssertEqual(transport.joins.count, 0)
        // 24 code points is the longest nickname, whatever its UTF-16 length.
        session.join("KXPD-RMTB", String(repeating: "\u{1F6B4}", count: 24), reply)
        XCTAssertEqual(transport.joins.count, 1)
        transport.answerJoin(.unreachable)
        joined()
        XCTAssertEqual(transport.joins.last?.session, "KXPD-RMTB")
        XCTAssertEqual(transport.joins.last?.nickname, "Sam")
        toPage = []
        session.join("KXPD-RMTB", "Sam", reply)
        XCTAssertEqual(toPage, ["refused"])
        XCTAssertEqual(transport.joins.count, 2)
    }

    func testASecondJoinWhileOneWaitsIsRefused() {
        session.join("KXPD-RMTB", "Sam", reply)
        session.join("KXPD-RMTB", "Sam", reply)
        XCTAssertEqual(toPage, ["refused"])
        XCTAssertEqual(transport.joins.count, 1)
    }

    func testNoHostEventOrOtherRolesMessageReachesThePageInRiderMode() {
        joined()
        let link = opened()
        var riderBound = Set<String>()
        for row in RiderExamples.all {
            XCTAssertEqual(RiderWire.riderBound(row.text), row.toRider, row.name)
            if row.toRider {
                riderBound.insert(RiderWire.type(row.text) ?? "")
            } else {
                link.events.text(row.text)
            }
        }
        XCTAssertEqual(riderBound, RiderWire.riderTypes)
        toPage = []
        session.receive(reply)
        // Only "opened" was waiting: every host, controller and server-bound message was dropped.
        XCTAssertEqual(toPage, [#"{"kind":"opened"}"#])
    }

    func testAFrameOfAnotherVersionAWelcomeAsHostOrOneTooLongIsDropped() {
        joined()
        let link = opened()
        link.events.text(#"{"v":2,"type":"host_status","connected":true}"#)
        link.events.text(#"{"v":true,"type":"host_status","connected":true}"#)
        link.events.text(#"{"v":"1","type":"host_status","connected":true}"#)
        link.events.text(#"{"v":1,"type":"welcome","role":"host"}"#)
        link.events.text(#"{"v":1,"type":"welcome"}"#)
        link.events.text(#"{"v":1,"type":"host_status","connected":true,"pad":"\#(String(repeating: "x", count: RiderWire.maxFrameChars))"}"#)
        link.events.text("not json")
        link.events.text(#"[{"v":1,"type":"ended"}]"#)
        toPage = []
        session.receive(reply)
        session.receive(reply)
        XCTAssertEqual(toPage, [#"{"kind":"opened"}"#])
        XCTAssertTrue(session.joined)
    }

    func testAFullQueueDropsPassingEventsNeverACloseOrTheClassesEnded() throws {
        joined()
        opened().events.closed(RiderClose.lost)
        let link = opened()
        let status = example("host-status/connected.json")
        for _ in 0..<(RiderSession.maxQueued * 2) { link.events.text(status) }
        link.events.text(example("ended/host-ended.json"))
        drain()
        // The join's and the opens' own answers have no "kind"; only the events do.
        let events = toPage.filter { $0 != "refused" }.compactMap(RiderFixtures.object).filter { $0["kind"] != nil }
        XCTAssertEqual(events.count, RiderSession.maxQueued)
        let closed = try XCTUnwrap(events.first { $0["kind"] as? String == "closed" })
        XCTAssertEqual(closed["code"] as? Int, RiderClose.lost)
        let last = try XCTUnwrap(RiderFixtures.object(events.last?["text"] as? String ?? ""))
        XCTAssertEqual(last["type"] as? String, "ended")
    }

    func testLeavingClosesTheLinkDropsTheTokenAndRefusesWhatComesLater() {
        joined()
        let link = opened()
        session.receive(reply)
        session.receive(reply) // waiting
        session.receive(reply) // a second wait is refused
        XCTAssertEqual(toPage.last, "refused")
        toPage = []
        session.leave(reply)
        XCTAssertEqual(toPage, ["refused", #"{"result":"left"}"#])
        XCTAssertFalse(session.joined)
        XCTAssertEqual(session.secrets, [])
        XCTAssertTrue(link.closed)
        // A late frame from the old link goes nowhere; nothing can be received or opened.
        link.events.text(example("host-status/connected.json"))
        link.events.closed(4401)
        toPage = []
        session.receive(reply)
        session.open(reply)
        XCTAssertEqual(toPage, ["refused", "refused"])
    }

    func testADropDuringAJoinKeepsNoTokenFromTheLateAnswer() {
        session.join("KXPD-RMTB", "Sam", reply)
        session.drop()
        transport.answerJoin(RiderFixtures.joinedAnswer)
        XCTAssertFalse(session.joined)
        XCTAssertEqual(toPage, ["refused"])
    }

    func testTheClassEndedOrTheTokenRefusedDropsTheTokenAndALostLinkKeepsItToReconnect() {
        joined()
        var link = opened()
        link.events.closed(RiderClose.lost)
        XCTAssertTrue(session.joined)
        link = opened()
        link.events.closed(4401)
        XCTAssertFalse(session.joined)
        // The page reads what was waiting: both links' events, the last its final close.
        for _ in 0..<4 { session.receive(reply) }
        XCTAssertEqual(toPage.last, #"{"code":4401,"kind":"closed"}"#)

        for code in [4403, 4409] {
            joined()
            opened().events.closed(code)
            XCTAssertFalse(session.joined, "\(code)")
        }

        toPage = []
        joined()
        link = opened()
        link.events.text(example("ended/dropped.json"))
        XCTAssertFalse(session.joined)
        XCTAssertTrue(link.closed)
        toPage = []
        drain()
        let kinds = toPage.compactMap { RiderFixtures.object($0)?["kind"] as? String }
        XCTAssertEqual(toPage.last, "refused")
        XCTAssertTrue(toPage.contains { $0.contains("dropped") })
        XCTAssertTrue(kinds.contains("opened"))
        assertTokenNeverReachedThePage()
    }

    func testTheSessionSaysWhenJoinedChanges() {
        var changes: [Bool] = []
        session.changed = { [unowned self] in changes.append(self.session.joined) }
        joined()
        session.leave(reply)
        XCTAssertEqual(changes, [true, false])
    }

    func testTheStandInTransportIsOfflineForEveryJoinAndEveryLink() {
        var posted: [() -> Void] = []
        let offline = RiderSession(transport: OfflineRiderTransport { posted.append($0) })
        offline.join("KXPD-RMTB", "Sam", reply)
        XCTAssertEqual(toPage, [])
        posted.removeFirst()()
        XCTAssertEqual(toPage, [#"{"result":"unreachable"}"#])
        XCTAssertFalse(offline.joined)

        final class Heard: RiderLinkEvents {
            var closedWith: [Int] = []
            func opened() {}
            func text(_ frame: String) {}
            func closed(_ code: Int) { closedWith.append(code) }
        }
        let heard = Heard()
        let link = OfflineRiderTransport { posted.append($0) }.open(heard)
        link.transmit("x")
        XCTAssertEqual(heard.closedWith, [])
        posted.removeFirst()()
        XCTAssertEqual(heard.closedWith, [RiderClose.lost])

        // A link closed before its turn hears nothing.
        let shut = Heard()
        OfflineRiderTransport { posted.append($0) }.open(shut).close()
        posted.removeFirst()()
        XCTAssertEqual(shut.closedWith, [])
    }
}
