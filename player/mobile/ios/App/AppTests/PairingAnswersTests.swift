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
        var unpair: (() -> Void)?
        func noLock(stay: @escaping () -> Void) { self.stay = stay }
        func riderQuestion(stay: @escaping () -> Void, switch: @escaping () -> Void) { self.stay = stay }
        func unpairQuestion(stay: @escaping () -> Void, unpair: @escaping () -> Void) {
            self.stay = stay
            self.unpair = unpair
        }
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
    private var pairing: FakePairingScreens!
    private var controller: ModeController!
    private var answered: [String: [[String: Any]]] = [:]

    override func setUp() {
        super.setUp()
        rig = PairingRig()
        lock = Lock()
        screens = Screens()
        pairing = FakePairingScreens()
        answered = [:]
        // No secrets passed: the controller reads the pairing's own, as the app's shell relies on.
        controller = ModeController(
            lock: lock,
            screens: screens,
            loader: Loader(),
            pairing: rig.ui(pairing),
            awake: KeepAwake(FakeFlag()),
            display: ExternalDisplay(source: FakeDisplays(), surface: FakeSurface()),
            rider: RiderSession(transport: FakeRiderTransport())
        ) { _ in
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

    /// Every intent of `mode` but the ones that open a native screen, which the test answers itself.
    private func callAll(_ mode: Mode, but asking: Set<String>) {
        for name in IntentPolicy.of(mode).sorted() where !asking.contains(name) {
            call(mode, name)
        }
    }

    private func assertNoSecret(file: StaticString = #filePath, line: UInt = #line) throws {
        for (name, answers) in answered {
            for answer in answers {
                let json = String(decoding: try JSONSerialization.data(withJSONObject: answer), as: UTF8.self)
                for secret in [Secrets.token(), Secrets.token("C"), Secrets.deviceCode()] {
                    XCTAssertFalse(json.contains(secret), "\(name) answered a secret", file: file, line: line)
                    XCTAssertFalse("\(answer)".contains(secret), "\(name) answered a secret", file: file, line: line)
                }
            }
        }
        // Nor does any word of the native pairing screen.
        for word in pairing.everyWord {
            for secret in [Secrets.token(), Secrets.token("C"), Secrets.deviceCode()] {
                XCTAssertFalse(word.contains(secret), "the pairing screen showed a secret", file: file, line: line)
            }
        }
    }

    func testNoAnswerCarriesTheTokenInEitherMode() throws {
        rig.pair()
        XCTAssertEqual(rig.service.secrets(), [Secrets.token()])
        try start()

        callAll(.rider, but: ["askInstructorMode"])
        XCTAssertEqual(answered["instructorWay"]?.first?["way"] as? String, "lock")
        XCTAssertEqual(answered["leave"]?.first?["result"] as? String, "left")

        let ask = call(.rider, "askInstructorMode")
        lock.done?(true)
        XCTAssertEqual(ask.refusals, 1)
        controller.shown(PageOpener.blank)
        controller.shown("/instructor.html")
        XCTAssertEqual(controller.current, .instructor)

        callAll(.instructor, but: ["askRiderMode", "pairAgain", "unpair"])
        // "Pair again" on a pairing that still works shows it paired; "Continue" goes back.
        let again = call(.instructor, "pairAgain")
        XCTAssertEqual(pairing.current?.keys.map { $0.label }, ["Continue"])
        pairing.press("Continue")
        XCTAssertEqual(again.answers.first?["result"] as? String, "paired")
        answered["pairAgain"] = again.answers
        let unpair = call(.instructor, "unpair")
        screens.stay?()
        XCTAssertEqual(unpair.answers.first?["result"] as? String, "stayed")
        answered["unpair"] = unpair.answers
        XCTAssertEqual(rig.service.secrets(), [Secrets.token()], "Stay keeps the pairing")
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
        let ask = call(.rider, "askInstructorMode")
        callAll(.rider, but: ["askInstructorMode"])
        XCTAssertEqual(answered["instructorWay"]?.first?["way"] as? String, "pair")
        // The pairing screen shows the code the user types, never the device code.
        XCTAssertTrue(pairing.words.contains("BCDF-GHJK"))
        XCTAssertNil(ask.answers.first)
        pairing.press("Cancel")
        XCTAssertEqual(ask.answers.first?["result"] as? String, "stayed")
        answered["askInstructorMode"] = ask.answers
        try assertNoSecret()
    }

    /// The controller's own guard knows the pairing's secrets without being handed them (issue
    /// #926): the device code while it waits, the token once paired.
    func testAnAnswerHoldingTheTokenWouldBeRefused() {
        rig.toWaiting()
        XCTAssertFalse(controller.mayAnswer(["way": Secrets.deviceCode()]))
        XCTAssertTrue(controller.mayAnswer(["way": "lock"]))
        rig.backend.ok(FakeBackend.tokenBody())
        XCTAssertFalse(controller.mayAnswer(["way": Secrets.token()]))
        XCTAssertFalse(controller.mayAnswer(["result": ["nested": "x" + Secrets.token() + "y"]]))
        XCTAssertTrue(controller.mayAnswer(["way": "lock"]))
    }

    /// Every answer to the page goes through `answer`, which refuses one holding the pairing's own
    /// secret, with no secrets passed in: the device code while waiting, the token once paired.
    func testTheAnswerPathRefusesThePairingsSecrets() {
        rig.toWaiting()
        let waiting = Call()
        controller.answer(waiting, ["way": Secrets.deviceCode()])
        XCTAssertEqual(waiting.refusals, 1)
        XCTAssertTrue(waiting.answers.isEmpty)
        rig.backend.ok(FakeBackend.tokenBody())
        let paired = Call()
        controller.answer(paired, ["result": ["nested": Secrets.token()]])
        XCTAssertEqual(paired.refusals, 1)
        XCTAssertTrue(paired.answers.isEmpty)
        let plain = Call()
        controller.answer(plain, ["way": "lock"])
        XCTAssertEqual(plain.refusals, 0)
        XCTAssertEqual(plain.answers.first?["way"] as? String, "lock")
    }

    /// The page's "unpair" (AC1): the page hears "unpaired", the Keychain token and the cached
    /// classes go, and instructor mode closes.
    func testUnpairWipesTheTokenAndClosesInstructorMode() throws {
        rig.pair()
        try start()
        call(.rider, "askInstructorMode")
        lock.done?(true)
        controller.shown(PageOpener.blank)
        controller.shown("/instructor.html")
        XCTAssertEqual(controller.current, .instructor)
        let unpair = call(.instructor, "unpair")
        XCTAssertNotNil(rig.store.text, "nothing is deleted before the answer")
        screens.unpair?()
        XCTAssertEqual(unpair.answers.first?["result"] as? String, "unpaired")
        XCTAssertNil(rig.store.text)
        XCTAssertGreaterThanOrEqual(rig.store.deletes, 1)
        XCTAssertEqual(rig.ports.cacheForgets, 1)
        XCTAssertEqual(rig.service.secrets(), [])
        controller.shown(PageOpener.blank)
        controller.shown("/rider.html")
        XCTAssertEqual(controller.current, .rider)
        XCTAssertEqual(controller.exposed, "RiderMode")
    }

    /// The page's "pairAgain" (AC1) reaches the pairing service: a pairing the backend no longer
    /// takes asks the server for a new code; Cancel keeps the expired pairing and its classes.
    func testPairAgainAsksTheServerForANewCode() throws {
        rig.pair()
        try start()
        call(.rider, "askInstructorMode")
        lock.done?(true)
        controller.shown(PageOpener.blank)
        controller.shown("/instructor.html")
        rig.service.refused(.expired)
        let requests = rig.backend.requests.count
        let again = call(.instructor, "pairAgain")
        XCTAssertEqual(rig.backend.requests.count, requests + 1, "pair again asks for a new code")
        rig.backend.ok(FakeBackend.startBody())
        XCTAssertTrue(pairing.words.contains("BCDF-GHJK"))
        XCTAssertEqual(call(.instructor, "unpair").refusals, 1, "no unpair while the pairing screen shows")
        pairing.swipe()
        XCTAssertEqual(again.answers.first?["result"] as? String, "stayed")
        XCTAssertNil(pairing.current)
        XCTAssertTrue(rig.service.paired, "the expired pairing is kept")
        XCTAssertEqual(controller.current, .instructor)
        try assertNoSecret()
    }

    /// A "pair again" whose token could not be kept (issue #926): instructor mode closes, and the
    /// save-failed plate stays over rider mode, so the user learns why.
    func testAPairAgainThatCannotKeepTheTokenShowsWhyOverRiderMode() throws {
        rig.pair()
        try start()
        call(.rider, "askInstructorMode")
        lock.done?(true)
        controller.shown(PageOpener.blank)
        controller.shown("/instructor.html")
        rig.service.refused(.expired)
        call(.instructor, "pairAgain")
        rig.backend.ok(FakeBackend.startBody())
        rig.ports.fireNext()
        rig.store.saves = false
        rig.backend.ok(FakeBackend.tokenBody(Secrets.token("C")))
        XCTAssertFalse(rig.service.paired)
        XCTAssertNil(rig.store.text)
        controller.shown(PageOpener.blank)
        controller.shown("/rider.html")
        XCTAssertEqual(controller.current, .rider)
        // A plate's words are its head and body, a line apart (ScreenLine.words).
        XCTAssertTrue(pairing.words.contains { $0.hasPrefix("The pairing could not be kept.\n") }, "the plate stays: \(pairing.words)")
        XCTAssertEqual(pairing.current?.keys.map { $0.label }, ["Start again", "Rider mode"])
        XCTAssertEqual(rig.service.view(), .unpaired(notice: .saveFailed))
        pairing.press("Rider mode")
        XCTAssertNil(pairing.current)
        XCTAssertEqual(rig.service.view(), .unpaired(notice: nil))
        XCTAssertEqual(controller.current, .rider)
        try assertNoSecret()
    }

}
