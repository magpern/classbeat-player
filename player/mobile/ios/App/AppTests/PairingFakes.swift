import XCTest
import Security
@testable import App

// The pairing's fakes (issue #896): a backend that never leaves the process, a store in memory, the
// clock and timer by hand, and a Keychain that records every query. No test reaches a network or a
// real backend.

/// Holds each call until the test answers it, and fails a test on any call the transport contract
/// refuses.
final class FakeBackend: BackendTransport {
    static let origin = "https://classbeat.test"

    var requests: [BackendRequest] = []
    private var waiting: [(HttpAnswer) -> Void] = []
    /// Tokens the backend holds as expired. As its `device_token` dependency does, every call made
    /// with one is answered 401 token_expired at once, before any route runs.
    var expired: Set<String> = []

    static let tokenExpired = HttpAnswer.http(status: 401, body: ["error": "token_expired"], retryAfterS: nil)

    func call(_ request: BackendRequest, answer: @escaping (HttpAnswer) -> Void) {
        XCTAssertNotNil(TransportContract.address(request, buildOrigin: Self.origin), "\(request)")
        requests.append(request)
        if let token = request.token, expired.contains(token) { return answer(Self.tokenExpired) }
        waiting.append(answer)
    }

    var open: Int { waiting.count }

    func answerNext(_ a: HttpAnswer) {
        guard !waiting.isEmpty else { return XCTFail("no call is waiting") }
        waiting.removeFirst()(a)
    }

    func ok(_ body: [String: Any]) { answerNext(.http(status: 200, body: body, retryAfterS: nil)) }

    static func startBody(interval: Any = 5) -> [String: Any] {
        [
            "device_code": Secrets.deviceCode(),
            "user_code": "BCDF-GHJK",
            "verification_uri": origin + "/pair",
            "expires_in": 600,
            "interval": interval,
        ]
    }

    static func tokenBody(_ token: String = Secrets.token(), email: Any = "rider@classbeat.test") -> [String: Any] {
        ["device_token": token, "email": email]
    }
}

final class FakeStore: SecretStore {
    var text: String?
    var isAvailable = true
    var saves = true
    var deletes = 0

    func available() -> Bool { isAvailable }

    func save(_ text: String) -> Bool {
        if saves { self.text = text }
        return saves
    }

    func load() -> String? { text }

    func delete() {
        deletes += 1
        text = nil
    }
}

final class FakePorts: PairingPorts {
    var time = 1_000
    var timers: [(at: Int, run: () -> Void)] = []
    var pages: [String] = []
    var cacheForgets = 0

    func now() -> Int { time }

    func at(_ time: Int, _ run: @escaping () -> Void) { timers.append((time, run)) }

    func openPage(_ page: String) -> Bool {
        pages.append(page)
        return true
    }

    func forgetCache() { cacheForgets += 1 }

    /// Moves the clock to the first timer and runs it.
    func fireNext() {
        guard !timers.isEmpty else { return XCTFail("no timer is set") }
        let next = timers.removeFirst()
        time = max(time, next.at)
        next.run()
    }
}

/// A Keychain in memory: generic passwords by account, every query kept, and each call able to fail.
final class FakeKeychain: KeychainCalls {
    var items: [String: Data] = [:]
    var log: [String] = []
    var added: [[String: Any]] = []
    var deleted: [[String: Any]] = []
    var addStatus: OSStatus = errSecSuccess
    var deleteStatus: OSStatus?

    func add(_ query: [String: Any]) -> OSStatus {
        log.append("add")
        added.append(query)
        guard addStatus == errSecSuccess, let account = query[kSecAttrAccount as String] as? String,
              let data = query[kSecValueData as String] as? Data else { return addStatus == errSecSuccess ? errSecParam : addStatus }
        if items[account] != nil { return errSecDuplicateItem }
        items[account] = data
        return errSecSuccess
    }

    func copy(_ query: [String: Any]) -> (OSStatus, Data?) {
        log.append("copy")
        guard let account = query[kSecAttrAccount as String] as? String, let data = items[account] else { return (errSecItemNotFound, nil) }
        return (errSecSuccess, data)
    }

    func delete(_ query: [String: Any]) -> OSStatus {
        log.append("delete")
        deleted.append(query)
        if let status = deleteStatus { return status }
        if let account = query[kSecAttrAccount as String] as? String {
            return items.removeValue(forKey: account) == nil ? errSecItemNotFound : errSecSuccess
        }
        // A whole class: on iOS one delete removes every item of the class.
        let isPasswords = (query[kSecClass as String] as? String) == (kSecClassGenericPassword as String)
        if !isPasswords || items.isEmpty { return errSecItemNotFound }
        items = [:]
        return errSecSuccess
    }
}

/// A service on the fakes, with the steps of a pairing.
final class PairingRig {
    let backend: FakeBackend
    let store: FakeStore
    let ports: FakePorts
    let service: PairingService

    init(origin: String? = FakeBackend.origin, store: SecretStore? = nil) {
        let backend = FakeBackend(), fake = FakeStore(), ports = FakePorts()
        self.backend = backend
        self.store = fake
        self.ports = ports
        service = PairingService(
            origin: origin,
            allowLoopbackHttp: false,
            version: "1.0.0",
            transport: backend,
            store: store ?? fake,
            ports: ports
        )
    }

    /// Begin, the start answer, the first poll: waiting for the token.
    func toWaiting() {
        service.begin()
        backend.ok(FakeBackend.startBody())
        ports.fireNext()
    }

    /// All the way to a held token.
    func pair(_ token: String = Secrets.token()) {
        toWaiting()
        backend.ok(FakeBackend.tokenBody(token))
    }

    /// The pairing screen's logic on this rig's service.
    func ui(_ screens: FakePairingScreens, _ ticker: FakeTicker = FakeTicker()) -> PairingUi {
        PairingUi(service: service, ports: ports, screens: screens, ticker: ticker)
    }
}

/// The pairing screen in memory (issue #925): every screen shown, and the keys pressed by label.
final class FakePairingScreens: PairingScreens {
    var shown: [PairingScreenModel.Screen] = []
    var current: PairingScreenModel.Screen?
    var shows = 0
    var retexts = 0
    var hides = 0
    private var pressing: ((PairingScreenModel.Action) -> Void)?

    func show(_ screen: PairingScreenModel.Screen, press: @escaping (PairingScreenModel.Action) -> Void) {
        shows += 1
        shown.append(screen)
        current = screen
        pressing = press
    }

    func retext(_ screen: PairingScreenModel.Screen) -> Bool {
        guard current != nil else { return false }
        retexts += 1
        shown.append(screen)
        current = screen
        return true
    }

    func hide() {
        hides += 1
        current = nil
        pressing = nil
    }

    /// Every word the screen shows now.
    var words: [String] { (current?.lines.map { $0.words } ?? []) + (current?.keys.map { $0.label } ?? []) }

    /// Every word any screen showed.
    var everyWord: [String] { shown.flatMap { $0.lines.map { $0.words } + $0.keys.map { $0.label } } }

    /// Presses the key with `label`; fails the test when the screen has none.
    func press(_ label: String, file: StaticString = #filePath, line: UInt = #line) {
        guard let key = current?.keys.first(where: { $0.label == label }) else {
            return XCTFail("no key \(label) in \(words)", file: file, line: line)
        }
        pressing?(key.action)
    }

    /// The edge swipe: "Cancel".
    func swipe() { pressing?(.cancel) }
}

final class FakeTicker: Ticker {
    var tick: (() -> Void)?
    var starts = 0
    var stops = 0

    var running: Bool { tick != nil }

    func start(_ tick: @escaping () -> Void) {
        starts += 1
        self.tick = tick
    }

    func stop() {
        stops += 1
        tick = nil
    }
}
