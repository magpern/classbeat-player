// Pairing this phone (issue #896, ADR 0016 section 4): the Swift twin of Android's
// PairingMachine.kt. An event and the time in, the next state and the effects for the edge. Pure:
// no import, no I/O, no timers, no clock. The device code and the token live in this state, in
// native code; the page gets only PairingView, which holds neither.
enum PairingMachine {
    /// The backend's interval is exact; each poll goes this much later so it is never early.
    static let pollMarginMs = 500
    /// RFC 8628 section 3.5: each `slow_down` adds 5 seconds.
    static let slowDownStepMs = 5000
    static let maxIntervalMs = 60_000

    static let initial: State = .unpaired(attempt: 0, notice: nil)

    private static func unpaired(_ attempt: Int, _ notice: Notice?, _ effects: [Effect] = []) -> Step {
        Step(state: .unpaired(attempt: attempt, notice: notice), effects: effects)
    }

    /// A pairing attempt ended without a token. A "pair again" goes back to the expired pairing it
    /// started from (its cached classes still play); a first pairing to unpaired.
    private static func ended(_ s: State, _ attempt: Int, _ notice: Notice?) -> Step {
        var back: Paired?
        if case let .starting(_, _, b) = s { back = b }
        if case let .waiting(w) = s { back = w.back }
        guard var p = back else { return unpaired(attempt, notice) }
        p.attempt = attempt
        p.notice = notice
        return Step(state: .paired(p))
    }

    /// The next poll, after `waitMs` and the margin, but never past the pairing's end.
    private static func wait(_ s: Waiting, _ now: Int, _ waitMs: Int) -> Step {
        var next = s
        next.polling = false
        let at = min(now + waitMs + pollMarginMs, s.expiresAt)
        return Step(state: .waiting(next), effects: [.wake(attempt: s.attempt, at: at)])
    }

    private static func polled(_ s: Waiting, _ answer: PairingProtocol.Poll, _ now: Int) -> Step {
        let state = State.waiting(s)
        switch answer {
        case let .ok(token, email):
            let record = PairingRecord(origin: s.origin, token: token, email: email)
            let p = Paired(attempt: s.attempt, record: record, deviceName: nil, expired: false, notice: nil)
            return Step(state: .paired(p), effects: [.save(attempt: s.attempt, record: record)])
        case let .retry(afterMs):
            return wait(s, now, max(s.intervalMs, min(afterMs ?? 0, maxIntervalMs)))
        case .unexpected:
            return ended(state, s.attempt, .unexpected)
        case let .refused(code):
            switch code {
            case PairingProtocol.pending: return wait(s, now, s.intervalMs)
            case PairingProtocol.slowDown:
                var slower = s
                slower.intervalMs = min(s.intervalMs + slowDownStepMs, maxIntervalMs)
                return wait(slower, now, slower.intervalMs)
            case PairingProtocol.denied: return ended(state, s.attempt, .denied)
            case PairingProtocol.expired: return ended(state, s.attempt, .codeExpired)
            default: return ended(state, s.attempt, .unexpected)
            }
        }
    }

    private static func started(_ s: State, _ attempt: Int, _ origin: String, _ back: Paired?, _ answer: PairingProtocol.Start, _ now: Int) -> Step {
        switch answer {
        case .tooMany: return ended(s, attempt, .tooMany)
        case .unreachable: return ended(s, attempt, .unreachable)
        case .unexpected: return ended(s, attempt, .unexpected)
        case let .started(deviceCode, userCode, page, expiresInMs, intervalMs):
            let waiting = Waiting(
                attempt: attempt, origin: origin, deviceCode: deviceCode, userCode: userCode, page: page,
                expiresAt: now + expiresInMs, intervalMs: intervalMs, polling: false, back: back
            )
            let next = wait(waiting, now, intervalMs)
            return Step(state: next.state, effects: [.openPage(page)] + next.effects)
        }
    }

    /// A token that arrives when nothing waits for it (after cancel, or for an older attempt) is
    /// never kept and never shown: it is given back to the backend that issued it, as a failed save
    /// is. The one exception is the token this state already holds.
    private static func late(_ s: State, _ origin: String, _ token: String, _ email: String?) -> Step {
        if case let .paired(p) = s, p.record.token == token { return Step(state: s) }
        return Step(state: s, effects: [.revoke(PairingRecord(origin: origin, token: token, email: email))])
    }

    static func step(_ s: State, _ e: Event, _ now: Int) -> Step {
        switch e {
        case let .loaded(record):
            guard case .unpaired(0, _) = s, let record = record else { return Step(state: s) }
            let p = Paired(attempt: 1, record: record, deviceName: nil, expired: false, notice: nil)
            return Step(state: .paired(p), effects: [.check(attempt: 1, record: record)])
        case let .begin(origin, keychain):
            return begin(s, origin, keychain)
        case let .started(attempt, answer):
            guard case let .starting(a, origin, back) = s, a == attempt else { return Step(state: s) }
            return started(s, a, origin, back, answer, now)
        case let .pollDue(attempt):
            guard case var .waiting(w) = s, w.attempt == attempt, !w.polling else { return Step(state: s) }
            if now >= w.expiresAt { return ended(s, w.attempt, .codeExpired) }
            w.polling = true
            return Step(state: .waiting(w), effects: [.pollCall(attempt: w.attempt, origin: w.origin, deviceCode: w.deviceCode)])
        case let .polled(attempt, origin, answer):
            if case let .waiting(w) = s, w.attempt == attempt, w.polling { return polled(w, answer, now) }
            if case let .ok(token, email) = answer { return late(s, origin, token, email) }
            return Step(state: s)
        case let .saved(attempt, ok):
            guard case let .paired(p) = s, p.attempt == attempt, !ok else { return Step(state: s) }
            // The token could not be kept: it is given back, so no device row waits for a holder,
            // and whatever the store still holds (an older pairing, after a "pair again") is
            // deleted too.
            return unpaired(p.attempt, .saveFailed, [.forget, .revoke(p.record)])
        case let .checked(attempt, answer):
            return checked(s, attempt, answer)
        case .seen:
            if case let .unpaired(a, notice) = s, notice != nil { return Step(state: .unpaired(attempt: a, notice: nil)) }
            return Step(state: s)
        case .unpair:
            switch s {
            case .unpaired: return Step(state: s)
            // Deleted here first, then given back to the backend; offline, it is deleted all the same.
            case let .paired(p): return unpaired(p.attempt + 1, .unpaired, [.forget, .revoke(p.record)])
            default: return ended(s, s.attempt + 1, nil)
            }
        }
    }

    private static func begin(_ s: State, _ origin: String?, _ keychain: Bool) -> Step {
        // A working pairing is ended with unpair first; one the backend no longer takes may pair again.
        var back: Paired?
        switch s {
        case .starting, .waiting: return Step(state: s)
        case let .paired(p):
            if !p.expired { return Step(state: s) }
            back = p
            back?.notice = nil
        case .unpaired: break
        }
        let attempt = s.attempt + 1
        guard let origin = origin else { return ended(.starting(attempt: attempt, origin: "", back: back), attempt, .noServer) }
        // No Keychain, no pairing: the token is never kept where it could be read in the clear.
        if !keychain { return ended(.starting(attempt: attempt, origin: "", back: back), attempt, .noKeychain) }
        return Step(state: .starting(attempt: attempt, origin: origin, back: back), effects: [.startCall(attempt: attempt, origin: origin)])
    }

    private static func checked(_ s: State, _ attempt: Int, _ answer: PairingProtocol.Device) -> Step {
        guard case var .paired(p) = s, p.attempt == attempt else { return Step(state: s) }
        switch answer {
        case let .ok(name):
            p.deviceName = name
            p.expired = false
            return Step(state: .paired(p))
        case .expired:
            p.expired = true
            return Step(state: .paired(p))
        // Revoked on the site or unknown to the backend: the token is deleted. A network error or a
        // server fault ("unknown") changes nothing.
        case .gone: return unpaired(p.attempt + 1, .revokedOnSite, [.forget])
        case .unknown: return Step(state: s)
        }
    }
}
