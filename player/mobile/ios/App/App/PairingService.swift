// Runs PairingMachine against the phone (issue #896, ADR 0016 section 4): the Swift twin of
// Android's PairingService.kt. The transport, the Keychain store, the timer and Safari each sit
// behind a port, so a test fakes every one. Not thread-safe: called on the main thread only, and
// the transport and the timer answer there.

/// What the pairing needs from the phone, each one small enough to fake in a test.
protocol PairingPorts: AnyObject {
    /// A monotonic clock in milliseconds.
    func now() -> Int

    /// Runs `run` once, on the main thread, at `time` (the machine ignores stale wakes).
    func at(_ time: Int, _ run: @escaping () -> Void)

    /// Opens the pairing page in Safari, never in the app's web view. False when it could not.
    func openPage(_ page: String) -> Bool

    /// Deletes every cached class: the pairing that fetched them is gone.
    func forgetCache()
}

/// What a screen may show of the pairing: never the token, never the device code.
enum PairingView: Equatable {
    case unpaired(notice: PairingMachine.Notice?)
    case starting
    case waiting(userCode: String, page: String, expiresAt: Int)
    /// `notice` says why a "pair again" ended without a new pairing.
    case paired(email: String?, deviceName: String?, expired: Bool, notice: PairingMachine.Notice?)
}

/// `origin` is the backend fixed in the build (nil when the build holds none it may call); a
/// stored record from any other backend is deleted, never used.
final class PairingService {
    private let origin: String?
    private let allowLoopbackHttp: Bool
    private let version: String
    private let transport: BackendTransport
    private let store: SecretStore
    private let ports: PairingPorts

    private(set) var state: PairingMachine.State = PairingMachine.initial

    /// After every change, for the screen.
    var changed: () -> Void = {}

    /// The token was deleted (unpaired here, revoked or unknown on the site): instructor mode closes.
    var forgotten: () -> Void = {}

    private var queue: [PairingMachine.Event] = []
    private var running = false

    init(origin: String?, allowLoopbackHttp: Bool, version: String, transport: BackendTransport, store: SecretStore, ports: PairingPorts) {
        self.origin = origin
        self.allowLoopbackHttp = allowLoopbackHttp
        self.version = version
        self.transport = transport
        self.store = store
        self.ports = ports
    }

    /// Reads the stored pairing once, at start. A record that cannot be read or is for another
    /// backend is deleted.
    func load() {
        let text = store.load()
        var record = text.flatMap { PairingRecord.parse($0, allowLoopbackHttp: allowLoopbackHttp) }
        if record?.origin != origin { record = nil }
        if text != nil && record == nil {
            store.delete()
            ports.forgetCache()
        }
        dispatch(.loaded(record))
    }

    /// Pair, or pair again after the token expired.
    func begin() { dispatch(.begin(origin: origin, keychain: store.available())) }

    /// Unpair when paired; cancel while pairing.
    func unpair() { dispatch(.unpair) }

    /// Cancel (or Back) on a pairing screen: stops an attempt, never ends a pairing held.
    func cancel() {
        switch state {
        case .starting, .waiting: dispatch(.unpair)
        default: break
        }
    }

    /// The pairing screen closed: a notice it showed is not shown again.
    func seen() { dispatch(.seen) }

    /// A player call was refused with a 401 that ends or pauses the pairing.
    func refused(_ refusal: PairingProtocol.Refusal) {
        guard case let .paired(p) = state else { return }
        dispatch(.checked(attempt: p.attempt, answer: refusal == .gone ? .gone : .expired))
    }

    /// Whether a pairing is held, expired or not: instructor mode may open.
    var paired: Bool {
        if case .paired = state { return true }
        return false
    }

    /// The record to call the backend with: paired, not expired, and for the build's backend.
    func credential() -> PairingRecord? {
        guard case let .paired(p) = state, !p.expired, p.record.origin == origin else { return nil }
        return p.record
    }

    /// Every secret this phone holds now, for the answer guard: the tokens (one kept in `back`)
    /// and the device code.
    func secrets() -> [String] {
        switch state {
        case let .paired(p): return [p.record.token]
        case let .waiting(w): return [w.deviceCode] + [w.back?.record.token].compactMap { $0 }
        case let .starting(_, _, back): return [back?.record.token].compactMap { $0 }
        case .unpaired: return []
        }
    }

    func view() -> PairingView {
        switch state {
        case let .unpaired(_, notice): return .unpaired(notice: notice)
        case .starting: return .starting
        case let .waiting(w): return .waiting(userCode: w.userCode, page: w.page, expiresAt: w.expiresAt)
        case let .paired(p): return .paired(email: p.record.email, deviceName: p.deviceName, expired: p.expired, notice: p.notice)
        }
    }

    /// Events queue: an effect that answers at once (the store) never re-enters the machine.
    private func dispatch(_ event: PairingMachine.Event) {
        queue.append(event)
        if running { return }
        running = true
        defer { running = false }
        while !queue.isEmpty {
            let step = PairingMachine.step(state, queue.removeFirst(), ports.now())
            state = step.state
            step.effects.forEach(run)
            changed()
        }
    }

    private func run(_ effect: PairingMachine.Effect) {
        switch effect {
        case let .startCall(attempt, origin):
            transport.call(Calls.pairingStart(origin, version)) { [weak self] answer in
                self?.dispatch(.started(attempt: attempt, answer: PairingProtocol.parseStart(answer, origin)))
            }
        // No browser: the screen still shows the code and the address, to type in on another device.
        case let .openPage(page):
            _ = ports.openPage(page)
        case let .wake(attempt, at):
            ports.at(at) { [weak self] in self?.dispatch(.pollDue(attempt: attempt)) }
        case let .pollCall(attempt, origin, deviceCode):
            transport.call(Calls.pairingToken(origin, deviceCode)) { [weak self] answer in
                self?.dispatch(.polled(attempt: attempt, origin: origin, answer: PairingProtocol.parsePoll(answer)))
            }
        case let .save(attempt, record):
            let ok = record.text().map { store.save($0) } ?? false
            queue.append(.saved(attempt: attempt, ok: ok))
        case let .check(attempt, record):
            transport.call(Calls.device(record.origin, record.token)) { [weak self] answer in
                self?.dispatch(.checked(attempt: attempt, answer: PairingProtocol.parseDevice(answer)))
            }
        case .forget:
            store.delete()
            ports.forgetCache()
            forgotten()
        // Given back to the backend; its answer changes nothing here.
        case let .revoke(record):
            transport.call(Calls.revoke(record.origin, record.token)) { _ in }
        }
    }
}
