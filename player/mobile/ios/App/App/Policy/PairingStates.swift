// The pairing machine's states, events and effects (issue #896, ADR 0016 section 4), apart from
// its rules in PairingMachine.swift. Pure: no import. The device code and the token live in these
// values, in native code; no text form or mirror of them shows either.
extension PairingMachine {
    /// Why the phone is not paired, said once. The phone never shows `noServer` or `unpaired`.
    enum Notice: Equatable {
        case noServer, noKeychain, tooMany, unreachable, unexpected, denied, codeExpired, saveFailed, revokedOnSite, unpaired
    }

    /// `notice` says why a "pair again" ended without a new pairing; the expired one is still held.
    struct Paired: Equatable {
        var attempt: Int
        var record: PairingRecord
        var deviceName: String?
        var expired: Bool
        var notice: Notice?
    }

    struct Waiting: Equatable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
        var attempt: Int
        var origin: String
        var deviceCode: String
        var userCode: String
        var page: String
        var expiresAt: Int
        var intervalMs: Int
        /// True while a poll is out: never two at once.
        var polling: Bool
        var back: Paired?

        var description: String { "Waiting(\(attempt), \(userCode), polling=\(polling))" }
        var debugDescription: String { description }
        var customMirror: Mirror { Mirror(self, children: ["waiting": description]) }
    }

    enum State: Equatable {
        case unpaired(attempt: Int, notice: Notice?)
        /// `back` is the expired pairing a "pair again" started from: kept, and returned to if this
        /// one ends.
        case starting(attempt: Int, origin: String, back: Paired?)
        case waiting(Waiting)
        case paired(Paired)

        var attempt: Int {
            switch self {
            case .unpaired(let a, _), .starting(let a, _, _): return a
            case .waiting(let w): return w.attempt
            case .paired(let p): return p.attempt
            }
        }
    }

    /// Its text and its mirror never show the device code or the token.
    enum Effect: Equatable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
        case startCall(attempt: Int, origin: String)
        case openPage(String)
        /// Send `.pollDue` for this attempt at `at` (the edge's one timer).
        case wake(attempt: Int, at: Int)
        case pollCall(attempt: Int, origin: String, deviceCode: String)
        case save(attempt: Int, record: PairingRecord)
        case check(attempt: Int, record: PairingRecord)
        case forget
        case revoke(PairingRecord)

        var description: String {
            switch self {
            case let .startCall(a, origin): return "StartCall(\(a), \(origin))"
            case let .openPage(page): return "OpenPage(\(page))"
            case let .wake(a, at): return "Wake(\(a), \(at))"
            case let .pollCall(a, _, _): return "PollCall(\(a))"
            case let .save(a, r): return "Save(\(a), \(r))"
            case let .check(a, r): return "Check(\(a), \(r))"
            case .forget: return "Forget"
            case let .revoke(r): return "Revoke(\(r))"
            }
        }

        var debugDescription: String { description }
        var customMirror: Mirror { Mirror(self, children: ["effect": description]) }
    }

    enum Event {
        case loaded(PairingRecord?)
        /// `origin` is nil when the build holds none this build may call.
        case begin(origin: String?, keychain: Bool)
        case started(attempt: Int, answer: PairingProtocol.Start)
        case pollDue(attempt: Int)
        /// `origin` is where the poll went, so a token nobody waits for can be given back to it.
        case polled(attempt: Int, origin: String, answer: PairingProtocol.Poll)
        case saved(attempt: Int, ok: Bool)
        case checked(attempt: Int, answer: PairingProtocol.Device)
        /// Unpair when paired; cancel while starting or waiting.
        case unpair
        /// The notice was shown and the screen left: it is not shown again.
        case seen
    }

    struct Step: Equatable {
        let state: State
        var effects: [Effect] = []
    }
}
