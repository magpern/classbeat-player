// How the pairing machine takes the backend's answers to the start and the poll calls (issue
// #896, split out of PairingMachine.swift in issue #926): the next poll, a token, a refusal, and a
// token nobody waits for. Pure: no import.
extension PairingMachine {
    /// The next poll, after `waitMs` and the margin, but never past the pairing's end.
    static func wait(_ s: Waiting, _ now: Int, _ waitMs: Int) -> Step {
        var next = s
        next.polling = false
        let at = min(now + waitMs + pollMarginMs, s.expiresAt)
        return Step(state: .waiting(next), effects: [.wake(attempt: s.attempt, at: at)])
    }

    static func polled(_ s: Waiting, _ answer: PairingProtocol.Poll, _ now: Int) -> Step {
        let state = State.waiting(s)
        switch answer {
        case let .ok(token, email):
            let record = PairingRecord(origin: s.origin, token: token, email: email)
            let p = Paired(attempt: s.attempt, record: record, deviceName: nil, expired: false, notice: nil)
            // A "pair again" replaces the expired token, and it is given back too, whether the new
            // one is kept or not (issue #926). Best effort only: the backend refuses an expired token
            // (401 token_expired) before its revoke runs, and ends it by idle expiry (ADR 0002), so
            // no answer changes anything here and the token is never kept or sent again.
            let old = s.back.map { [Effect.revoke($0.record)] } ?? []
            return Step(state: .paired(p), effects: [.save(attempt: s.attempt, record: record)] + old)
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

    static func started(_ s: State, _ attempt: Int, _ origin: String, _ back: Paired?, _ answer: PairingProtocol.Start, _ now: Int) -> Step {
        switch answer {
        case .tooMany: return ended(s, attempt, .tooMany)
        case .unreachable: return ended(s, attempt, .unreachable)
        case .unexpected: return ended(s, attempt, .unexpected)
        case let .started(deviceCode, userCode, page, expiresInMs, intervalMs):
            let waiting = Waiting(
                attempt: attempt, origin: origin, deviceCode: deviceCode, userCode: userCode, page: page,
                expiresAt: now + expiresInMs, intervalMs: intervalMs, polling: false, back: back
            )
            // No page opens here: the code shows first, and the page opens only on "Open the site"
            // (docs/design/app-pairing.md item 5).
            return wait(waiting, now, intervalMs)
        }
    }

    /// A token that arrives when nothing waits for it (after cancel, or for an older attempt) is
    /// never kept and never shown: it is given back to the backend that issued it, as a failed save
    /// is. The one exception is the token this state already holds.
    static func late(_ s: State, _ origin: String, _ token: String, _ email: String?) -> Step {
        if case let .paired(p) = s, p.record.token == token { return Step(state: s) }
        return Step(state: s, effects: [.revoke(PairingRecord(origin: origin, token: token, email: email))])
    }
}
