import XCTest
@testable import App

// The token never reaches JavaScript (issue #896): with a real pairing service holding a token (or a
// device code while it waits), every intent the page may call, in its own mode and with valid
// arguments, is answered without either secret.
final class PairingAnswersTests: XCTestCase {
    private final class Lock: ScreenLock {
        var isSet = true
        var done: ((Bool) -> Void)?
        func ask(_ done: @escaping (Bool) -> Void) { self.done = done }
    }

    private final class Screens: ModeScreens {
        var stay: (() -> Void)?
        func noLock(stay: @escaping () -> Void) { self.stay = stay }
        func riderQuestion(stay: @escaping () -> Void, switch: @escaping () -> Void) { self.stay = stay }
        func switching(rider: Bool) {}
        func hide() {}
    }

    private final class Loader: PageLoader {
        func load(_ path: String) {}
    }

    private final class Call: PageCall {
        var answers: [[String: Any]] = []
        var refusals = 0
        func answer(_ data: [String: Any]) { answers.append(data) }
        func refuse() { refusals += 1 }
    }

    private final class Store: ModeStore {
        var value: String?
        var wipe = false
        func read() -> String? { value }
        func write(_ value: String) throws { self.value = value }
        func wipePending() -> Bool { wipe }
        func setWipePending(_ pending: Bool) throws { wipe = pending }
    }

    private var rig: PairingRig!
    private var lock: Lock!
    private var screens: Screens!
    private var controller: ModeController!
    private var answered: [String: [[String: Any]]] = [:]

    override func setUp() {
        super.setUp()
        rig = PairingRig()
        lock = Lock()
        screens = Screens()
        answered = [:]
        let service = rig.service
        controller = ModeController(lock: lock, screens: screens, loader: Loader(), secrets: { service.secrets() }) { _ in
            XCTFail("a switch could not drop everything")
        }
    }

    private func start() throws {
        let service = rig.service
        let parts = ModePolicy.teardown.map { name in Teardown(name: name) { done in done(nil) } }
        try controller.start(device: PhoneDevice(lock: lock) { service.paired }, store: Store(), parts: parts)
        controller.shown(PageOpener.blank)
        controller.shown("/rider.html")
        XCTAssertEqual(controller.current, .rider)
    }

    private func args(_ name: String) -> [String: Any] {
        var out: [String: Any] = [:]
        for (key, type) in IntentPolicy.intents[name]?.args ?? [:] {
            switch type {
            case .string: out[key] = "x"
            case .boolean: out[key] = true
            case .number: out[key] = 1
            }
        }
        return out
    }

    @discardableResult
    private func call(_ mode: Mode, _ name: String) -> Call {
        let call = Call()
        controller.handle(mode, name, args(name), call)
        answered[name] = call.answers
        return call
    }

    /// Every intent of `mode` but the one that leaves it.
    private func callAll(_ mode: Mode, but leaving: String) {
        for name in IntentPolicy.of(mode).sorted() where name != leaving {
            call(mode, name)
        }
    }

    private func assertNoSecret(file: StaticString = #filePath, line: UInt = #line) throws {
        for (name, answers) in answered {
            for answer in answers {
                let json = String(decoding: try JSONSerialization.data(withJSONObject: answer), as: UTF8.self)
                for secret in [Secrets.token(), Secrets.deviceCode()] {
                    XCTAssertFalse(json.contains(secret), "\(name) answered a secret", file: file, line: line)
                    XCTAssertFalse("\(answer)".contains(secret), "\(name) answered a secret", file: file, line: line)
                }
            }
        }
    }

    func testNoAnswerCarriesTheTokenInEitherMode() throws {
        rig.pair()
        XCTAssertEqual(rig.service.secrets(), [Secrets.token()])
        try start()

        callAll(.rider, but: "askInstructorMode")
        XCTAssertEqual(answered["instructorWay"]?.first?["way"] as? String, "lock")
        XCTAssertEqual(answered["leave"]?.first?["result"] as? String, "left")

        let ask = call(.rider, "askInstructorMode")
        lock.done?(true)
        XCTAssertEqual(ask.refusals, 1)
        controller.shown(PageOpener.blank)
        controller.shown("/instructor.html")
        XCTAssertEqual(controller.current, .instructor)

        callAll(.instructor, but: "askRiderMode")
        let back = call(.instructor, "askRiderMode")
        screens.stay?()
        XCTAssertEqual(back.answers.first?["result"] as? String, "stayed")
        answered["askRiderMode"] = back.answers

        XCTAssertEqual(Set(answered.keys), Set(IntentPolicy.intents.keys))
        XCTAssertGreaterThan(answered.values.filter { !$0.isEmpty }.count, 10)
        try assertNoSecret()
    }

    func testNoAnswerCarriesTheDeviceCodeWhilePairing() throws {
        rig.toWaiting()
        XCTAssertEqual(rig.service.secrets(), [Secrets.deviceCode()])
        try start()
        callAll(.rider, but: "")
        XCTAssertEqual(answered["instructorWay"]?.first?["way"] as? String, "pair")
        XCTAssertEqual(answered["askInstructorMode"]?.first?["result"] as? String, "unpaired")
        try assertNoSecret()
    }

    func testAnAnswerHoldingTheTokenWouldBeRefused() {
        rig.pair()
        XCTAssertFalse(AnswerPolicy.mayAnswer(["way": Secrets.token()], rig.service.secrets()))
        XCTAssertTrue(AnswerPolicy.mayAnswer(["way": "lock"], rig.service.secrets()))
    }

    func testUnpairingClosesInstructorMode() throws {
        rig.pair()
        rig.service.forgotten = { [weak c = controller] in c?.unpaired() }
        try start()
        call(.rider, "askInstructorMode")
        lock.done?(true)
        controller.shown(PageOpener.blank)
        controller.shown("/instructor.html")
        XCTAssertEqual(controller.current, .instructor)
        rig.service.unpair()
        controller.shown(PageOpener.blank)
        controller.shown("/rider.html")
        XCTAssertEqual(controller.current, .rider)
    }
}
