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

    static func unpaired(_ attempt: Int, _ notice: Notice?, _ effects: [Effect] = []) -> Step {
        Step(state: .unpaired(attempt: attempt, notice: notice), effects: effects)
    }

    /// A pairing attempt ended without a token. A "pair again" goes back to the expired pairing it
    /// started from (its cached classes still play); a first pairing to unpaired.
    static func ended(_ s: State, _ attempt: Int, _ notice: Notice?) -> Step {
        var back: Paired?
        if case let .starting(_, _, b) = s { back = b }
        if case let .waiting(w) = s { back = w.back }
        guard var p = back else { return unpaired(attempt, notice) }
        p.attempt = attempt
        p.notice = notice
        return Step(state: .paired(p))
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
        // No server is asked first, as on Android: with nowhere to pair, the Keychain does not
        // matter, so a build without a backend shows "could not be reached" (issue #926).
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
