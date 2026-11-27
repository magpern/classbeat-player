import XCTest
@testable import App

// The pairing machine (issue #896), the twin of Android's PairingMachineTest.kt: every event in
// every state that matters, the attempt counter that drops stale answers, and no text form that
// shows a secret.
final class PairingMachineTests: XCTestCase {
    private typealias M = PairingMachine
    private let origin = "https://classbeat.test"
    private let page = "https://classbeat.test/pair"

    private var record: PairingRecord { PairingRecord(origin: origin, token: Secrets.token(), email: "rider@classbeat.test") }

    private func started(interval: Int = 5000) -> PairingProtocol.Start {
        .started(deviceCode: Secrets.deviceCode(), userCode: "BCDF-GHJK", page: page, expiresInMs: 600_000, intervalMs: interval)
    }

    private func paired(_ p: M.State) -> M.Paired? {
        if case let .paired(x) = p { return x }
        return nil
    }

    private func waiting(_ s: M.State) -> M.Waiting? {
        if case let .waiting(w) = s { return w }
        return nil
    }

    /// Begin and the start answer at time 0: waiting, the first poll due at 5.5 s.
    private func toWaiting(from s: M.State = M.initial, back: M.Paired? = nil) -> M.State {
        let begun = M.step(s, .begin(origin: origin, keychain: true), 0)
        let attempt = begun.state.attempt
        XCTAssertEqual(begun.state, .starting(attempt: attempt, origin: origin, back: back))
        XCTAssertEqual(begun.effects, [.startCall(attempt: attempt, origin: origin)])
        let w = M.step(begun.state, .started(attempt: attempt, answer: started()), 0)
        XCTAssertEqual(w.effects, [.wake(attempt: attempt, at: 5500)], "no page opens until the key is pressed")
        return w.state
    }

    private func polling(_ s: M.State, at now: Int = 5500) -> M.State {
        let step = M.step(s, .pollDue(attempt: s.attempt), now)
        XCTAssertEqual(step.effects, [.pollCall(attempt: s.attempt, origin: origin, deviceCode: Secrets.deviceCode())])
        return step.state
    }

    private func pairedState() -> M.State {
        let s = polling(toWaiting())
        return M.step(s, .polled(attempt: s.attempt, origin: origin, answer: .ok(token: Secrets.token(), email: "rider@classbeat.test")), 6000).state
    }

    func testAStoredRecordIsHeldAndCheckedOnceAtStart() {
        let step = M.step(M.initial, .loaded(record), 0)
        XCTAssertEqual(paired(step.state)?.record, record)
        XCTAssertEqual(step.effects, [.check(attempt: 1, record: record)])
        // Only the first load counts, and no record means unpaired.
        XCTAssertEqual(M.step(step.state, .loaded(nil), 0).state, step.state)
        XCTAssertEqual(M.step(M.initial, .loaded(nil), 0), M.Step(state: M.initial))
    }

    func testPairingRunsFromBeginToASavedToken() {
        let s = polling(toWaiting())
        let w = waiting(s)
        XCTAssertEqual(w?.polling, true)
        // A second wake while a poll is out sends nothing.
        XCTAssertEqual(M.step(s, .pollDue(attempt: s.attempt), 5600).effects, [])
        let done = M.step(s, .polled(attempt: s.attempt, origin: origin, answer: .ok(token: Secrets.token(), email: nil)), 6000)
        let held = PairingRecord(origin: origin, token: Secrets.token(), email: nil)
        XCTAssertEqual(paired(done.state)?.record, held)
        XCTAssertEqual(done.effects, [.save(attempt: s.attempt, record: held)])
        // A save that held changes nothing.
        XCTAssertEqual(M.step(done.state, .saved(attempt: s.attempt, ok: true), 6000).state, done.state)
    }

    func testPendingWaitsTheIntervalAndSlowDownAddsFiveSecondsUpToAMinute() {
        let s = polling(toWaiting())
        let pending = M.step(s, .polled(attempt: s.attempt, origin: origin, answer: .refused(PairingProtocol.pending)), 6000)
        XCTAssertEqual(pending.effects, [.wake(attempt: s.attempt, at: 11_500)])
        XCTAssertEqual(waiting(pending.state)?.polling, false)

        var state = polling(pending.state, at: 11_500)
        var interval = 5000
        for _ in 0..<15 {
            let slow = M.step(state, .polled(attempt: state.attempt, origin: origin, answer: .refused(PairingProtocol.slowDown)), 20_000)
            interval = min(interval + M.slowDownStepMs, M.maxIntervalMs)
            XCTAssertEqual(waiting(slow.state)?.intervalMs, interval)
            XCTAssertEqual(slow.effects, [.wake(attempt: state.attempt, at: 20_000 + interval + M.pollMarginMs)])
            state = polling(slow.state, at: 20_000)
        }
        XCTAssertEqual(interval, M.maxIntervalMs)
    }

    func testARetryWaitsAtLeastTheIntervalAndAtMostAMinuteButNeverPastTheEnd() {
        let s = polling(toWaiting())
        let r = { (ms: Int?) in M.step(s, .polled(attempt: s.attempt, origin: self.origin, answer: .retry(afterMs: ms)), 6000).effects }
        XCTAssertEqual(r(nil), [.wake(attempt: s.attempt, at: 11_500)])
        XCTAssertEqual(r(1000), [.wake(attempt: s.attempt, at: 11_500)])
        XCTAssertEqual(r(30_000), [.wake(attempt: s.attempt, at: 36_500)])
        XCTAssertEqual(r(600_000), [.wake(attempt: s.attempt, at: 66_500)])
        let late = M.step(s, .polled(attempt: s.attempt, origin: origin, answer: .retry(afterMs: 60_000)), 590_000)
        XCTAssertEqual(late.effects, [.wake(attempt: s.attempt, at: 600_000)])
        // Due at the end: the code ran out, no poll goes.
        let end = M.step(late.state, .pollDue(attempt: s.attempt), 600_000)
        XCTAssertEqual(end, M.Step(state: .unpaired(attempt: s.attempt, notice: .codeExpired)))
    }

    func testEveryWayAnAttemptEndsSaysWhy() {
        let s = polling(toWaiting())
        let end = { (a: PairingProtocol.Poll) in M.step(s, .polled(attempt: s.attempt, origin: self.origin, answer: a), 6000) }
        XCTAssertEqual(end(.refused(PairingProtocol.denied)), M.Step(state: .unpaired(attempt: 1, notice: .denied)))
        XCTAssertEqual(end(.refused(PairingProtocol.expired)), M.Step(state: .unpaired(attempt: 1, notice: .codeExpired)))
        XCTAssertEqual(end(.refused("other")), M.Step(state: .unpaired(attempt: 1, notice: .unexpected)))
        XCTAssertEqual(end(.unexpected), M.Step(state: .unpaired(attempt: 1, notice: .unexpected)))

        let begun = M.step(M.initial, .begin(origin: origin, keychain: true), 0).state
        let start = { (a: PairingProtocol.Start) in M.step(begun, .started(attempt: 1, answer: a), 0) }
        XCTAssertEqual(start(.tooMany), M.Step(state: .unpaired(attempt: 1, notice: .tooMany)))
        XCTAssertEqual(start(.unreachable), M.Step(state: .unpaired(attempt: 1, notice: .unreachable)))
        XCTAssertEqual(start(.unexpected), M.Step(state: .unpaired(attempt: 1, notice: .unexpected)))
    }

    func testNoBackendOrNoKeychainMeansNoCallAtAll() {
        XCTAssertEqual(M.step(M.initial, .begin(origin: nil, keychain: true), 0), M.Step(state: .unpaired(attempt: 1, notice: .noServer)))
        XCTAssertEqual(M.step(M.initial, .begin(origin: origin, keychain: false), 0), M.Step(state: .unpaired(attempt: 1, notice: .noKeychain)))
        // Neither: no server is the one named, as on Android (issue #926).
        XCTAssertEqual(M.step(M.initial, .begin(origin: nil, keychain: false), 0), M.Step(state: .unpaired(attempt: 1, notice: .noServer)))
    }

    func testBeginIsIgnoredWhilePairingOrPaired() {
        let s = toWaiting()
        XCTAssertEqual(M.step(s, .begin(origin: origin, keychain: true), 0), M.Step(state: s))
        let p = pairedState()
        XCTAssertEqual(M.step(p, .begin(origin: origin, keychain: true), 0), M.Step(state: p))
    }

    func testCancelEndsTheAttemptAndALateTokenIsGivenBack() {
        let s = polling(toWaiting())
        let cancelled = M.step(s, .unpair, 6000)
        XCTAssertEqual(cancelled, M.Step(state: .unpaired(attempt: 2, notice: nil)))
        let late = M.step(cancelled.state, .polled(attempt: 1, origin: origin, answer: .ok(token: Secrets.token(), email: nil)), 7000)
        XCTAssertEqual(late.state, cancelled.state)
        XCTAssertEqual(late.effects, [.revoke(PairingRecord(origin: origin, token: Secrets.token(), email: nil))])
        // A stale start answer and a stale wake change nothing.
        XCTAssertEqual(M.step(cancelled.state, .started(attempt: 1, answer: started()), 7000), M.Step(state: cancelled.state))
        XCTAssertEqual(M.step(cancelled.state, .pollDue(attempt: 1), 7000), M.Step(state: cancelled.state))
    }

    func testAFailedSaveUnpairsDeletesAndGivesTheTokenBack() {
        let p = pairedState()
        let step = M.step(p, .saved(attempt: p.attempt, ok: false), 6000)
        XCTAssertEqual(step.state, .unpaired(attempt: 1, notice: .saveFailed))
        XCTAssertEqual(step.effects, [.forget, .revoke(PairingRecord(origin: origin, token: Secrets.token(), email: "rider@classbeat.test"))])
    }

    func testUnpairDeletesFirstThenGivesTheTokenBack() {
        let p = pairedState()
        let step = M.step(p, .unpair, 7000)
        XCTAssertEqual(step.state, .unpaired(attempt: 2, notice: .unpaired))
        XCTAssertEqual(step.effects.first, .forget)
        XCTAssertEqual(step.effects.count, 2)
        XCTAssertEqual(M.step(step.state, .unpair, 7000), M.Step(state: step.state))
        XCTAssertEqual(M.step(step.state, .seen, 7000).state, .unpaired(attempt: 2, notice: nil))
    }

    func testTheCheckNamesTheDeviceMarksItExpiredOrForgetsIt() {
        let p = M.step(M.initial, .loaded(record), 0).state
        let named = M.step(p, .checked(attempt: 1, answer: .ok(name: "Phone")), 0).state
        XCTAssertEqual(paired(named)?.deviceName, "Phone")
        let expired = M.step(named, .checked(attempt: 1, answer: .expired), 0).state
        XCTAssertEqual(paired(expired)?.expired, true)
        XCTAssertEqual(M.step(expired, .checked(attempt: 1, answer: .unknown), 0).state, expired)
        XCTAssertEqual(M.step(p, .checked(attempt: 1, answer: .gone), 0), M.Step(state: .unpaired(attempt: 2, notice: .revokedOnSite), effects: [.forget]))
        // An answer for another attempt changes nothing.
        XCTAssertEqual(M.step(p, .checked(attempt: 7, answer: .gone), 0), M.Step(state: p))
    }

    func testPairAgainKeepsTheExpiredPairingAndReturnsToItWhenTheAttemptEnds() {
        let p = M.step(M.initial, .loaded(record), 0).state
        let expired = M.step(p, .checked(attempt: 1, answer: .expired), 0).state
        guard let back = paired(expired) else { return XCTFail("not paired") }
        let s = polling(toWaiting(from: expired, back: back))
        XCTAssertEqual(waiting(s)?.back?.record, record)
        let denied = M.step(s, .polled(attempt: s.attempt, origin: origin, answer: .refused(PairingProtocol.denied)), 6000)
        XCTAssertEqual(paired(denied.state)?.record, record)
        XCTAssertEqual(paired(denied.state)?.expired, true)
        XCTAssertEqual(paired(denied.state)?.notice, .denied)
        XCTAssertEqual(denied.state.attempt, s.attempt)
    }

    func testASuccessfulPairAgainGivesTheExpiredTokenBack() {
        let p = M.step(M.initial, .loaded(record), 0).state
        let expired = M.step(p, .checked(attempt: 1, answer: .expired), 0).state
        guard let back = paired(expired) else { return XCTFail("not paired") }
        let s = polling(toWaiting(from: expired, back: back))
        let fresh = Secrets.token("C")
        let step = M.step(s, .polled(attempt: s.attempt, origin: origin, answer: .ok(token: fresh, email: nil)), 6000)
        let made = PairingRecord(origin: origin, token: fresh, email: nil)
        XCTAssertEqual(paired(step.state)?.record, made)
        XCTAssertEqual(step.effects, [.save(attempt: s.attempt, record: made), .revoke(record)])
        // A first pairing has nothing to give back.
        let first = polling(toWaiting())
        let none = M.step(first, .polled(attempt: first.attempt, origin: origin, answer: .ok(token: fresh, email: nil)), 6000)
        XCTAssertEqual(none.effects, [.save(attempt: first.attempt, record: made)])
    }

    func testNoTextFormShowsTheTokenOrTheDeviceCode() {
        let s = polling(toWaiting())
        let p = pairedState()
        let things: [Any] = [
            s, p, waiting(s) as Any, record, started(),
            M.Effect.pollCall(attempt: 1, origin: origin, deviceCode: Secrets.deviceCode()),
            M.Effect.save(attempt: 1, record: record), M.Effect.revoke(record), M.Effect.check(attempt: 1, record: record),
            PairingProtocol.Poll.ok(token: Secrets.token(), email: nil),
            Calls.device(origin, Secrets.token()), Calls.pairingToken(origin, Secrets.deviceCode()),
        ]
        for thing in things {
            for text in [String(describing: thing), String(reflecting: thing), "\(thing)"] {
                XCTAssertFalse(text.contains(Secrets.token()), "a token in \(type(of: thing))")
                XCTAssertFalse(text.contains(Secrets.deviceCode()), "a device code in \(type(of: thing))")
            }
            var dumped = ""
            dump(thing, to: &dumped)
            XCTAssertFalse(dumped.contains(Secrets.token()), "a token in the dump of \(type(of: thing))")
            XCTAssertFalse(dumped.contains(Secrets.deviceCode()), "a device code in the dump of \(type(of: thing))")
        }
    }
}
