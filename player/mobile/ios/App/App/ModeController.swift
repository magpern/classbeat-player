// The iOS side of the mode holder (issue #895): it puts the current mode's plugin on the bridge,
// loads the mode's pages and no other, shows the native screens and asks the device owner's
// authentication. It also tells ScreenFollower what the idle timer and the external display follow
// (issue #897). The holder and the policies decide; this only carries
// it out, as Android's ModeController.kt.
// Every method runs on the main thread. Pure: no import at all; the screen lock, the screens and
// the web view come in through the protocols in ModeSeams.swift, so the tests fake every one of them
// (AppTests/ModeControllerTests.swift).

final class ModeController: ModeEffects, PageSteps, UnpairSteps {
    private final class Held {
        let call: PageCall
        init(_ call: PageCall) { self.call = call }
    }

    private let lock: ScreenLock
    private let screens: ModeScreens
    private let loader: PageLoader
    private let pairing: PairingUi
    private let screen: ScreenFollower
    private let secrets: () -> [String]
    private let stop: ([String]) -> Void
    private var holder: ModeHolder?
    private lazy var opener = PageOpener(self)
    private var question: PageQuestion<Held>!
    private lazy var unpairing = UnpairQuestion(self)

    /// The mode whose plugin is on the bridge; nil while none is.
    private var exposedMode: Mode?

    /// `secrets` are the tokens the device holds, which no answer may carry; `stop` ends the app
    /// when a switch could not drop everything.
    init(
        lock: ScreenLock,
        screens: ModeScreens,
        loader: PageLoader,
        pairing: PairingUi,
        awake: KeepAwake,
        display: ExternalDisplay,
        secrets: @escaping () -> [String] = { [] },
        stop: @escaping ([String]) -> Void
    ) {
        self.lock = lock
        self.screens = screens
        self.loader = loader
        self.pairing = pairing
        screen = ScreenFollower(awake: awake, display: display)
        self.secrets = secrets
        self.stop = stop
        question = PageQuestion<Held>(
            resolve: { [weak self] held, word in self?.answer(held.call, ["result": word]) },
            refuse: { held in held.call.refuse() }
        )
        // The token was deleted (unpaired here, revoked or unknown on the site): instructor mode closes.
        pairing.service.forgotten = { [weak self] in self?.unpaired() }
    }

    /// Opens the app in rider mode. Throws if the parts are not the ones ModePolicy.teardown names.
    func start(device: Device, store: ModeStore, parts: [Teardown]) throws {
        let holder = try ModeHolder(store: store, device: device, effects: self, parts: parts)
        self.holder = holder
        screen.launched()
        holder.start()
        screen.follow(current)
    }

    var current: Mode? { holder?.current }

    /// The one plugin the page may call now, by name; nil while none may.
    var exposed: String? { exposedMode?.plugin }

    // The web view's gate: asked before any main-frame page loads, told when one commits.

    func mayShow(_ path: String) -> Bool {
        opener.mayShow(path) ?? ModePolicy.mayShow(current, path)
    }

    func shown(_ path: String) {
        screen.committed(path)
        opener.committed(path)
        screen.follow(current)
    }

    // From the page, through the mode plugins.

    /// A call to `name` on `plugin`'s plugin. Refused unless that plugin is on the bridge and
    /// IntentPolicy lets the call through in the current mode.
    func handle(_ plugin: Mode, _ name: String, _ args: [String: Any], _ call: PageCall) {
        guard let holder = holder, exposedMode == plugin,
              IntentPolicy.check(holder.current, plugin, name, args) == nil else {
            call.refuse()
            return
        }
        switch name {
        case "instructorWay":
            answer(call, ["way": holder.paired ? "lock" : "pair"])
        case "askInstructorMode":
            question.ask(Held(call)) {
                if pairing.showing { return false }
                switch holder.askInstructor() {
                case nil:
                    return false
                // On an unpaired phone the strip's key starts pairing, on the native pairing screen.
                case .pair:
                    pairing.open(instructor: false) { [weak self] made in self?.pairingLeft(made) }
                    return true
                case .noLock, .askLock:
                    return true
                }
            }
        // "Pair again" (the pairing expired): the same native screen, from instructor mode.
        case "pairAgain":
            question.ask(Held(call)) {
                if pairing.showing { return false }
                pairing.open(instructor: true) { [weak self] made in self?.pairingLeft(made) }
                return true
            }
        // "Unpair this phone": asks first; only "Unpair" deletes anything.
        case "unpair":
            question.ask(Held(call)) {
                if pairing.showing || holder.pending != nil || holder.current != .instructor { return false }
                unpairing.ask()
                return true
            }
        case "askRiderMode":
            question.ask(Held(call)) { holder.askRider() }
        default:
            guard let fixed = IntentAnswers.fixed(name) else {
                call.refuse()
                return
            }
            answer(call, fixed)
        }
    }

    // From the app's life.

    /// Back in the app: a passcode may have been set meanwhile, and a code may have been confirmed.
    func resumed() {
        pairing.resumed()
        screen.front(true, current)
        guard let holder = holder, holder.pending == .noLock else { return }
        holder.noLockReturned()
        // No longer paired: nothing to ask, so the screen goes and the page hears so.
        if holder.pending == nil {
            screens.hide()
            question.settle("unpaired")
        }
    }

    /// Leaving the app while the rider or the unpair question shows means "Stay". The pairing
    /// screen stays, as the site opens in Safari, but asks the server nothing until the app is back.
    func stopped() {
        screen.front(false, current)
        pairing.stopped()
        if holder?.pending == .riderQuestion || unpairing.showing { stay() }
    }

    /// The pairing's token was deleted (unpaired, revoked or unknown on the site): instructor mode closes.
    func unpaired() {
        holder?.unpaired()
    }

    // ModeEffects.

    func closeBridge() {
        expose(nil)
        pairing.drop()
        unpairing.close()
        screen.between(current)
        // The page that asked is being replaced: its question ends here, with the one refused word.
        question.drop()
    }

    /// Through the blank page: the mode's plugin goes on only once the last page is gone (PageOpener).
    func open(_ mode: Mode) {
        opener.open(mode)
    }

    func askLock() {
        lock.ask { [weak self] passed in self?.lockAnswered(passed) }
    }

    func showNoLock() {
        screens.noLock(stay: { [weak self] in self?.stay() })
    }

    func askRiderQuestion() {
        screens.riderQuestion(
            stay: { [weak self] in self?.stay() },
            switch: { [weak self] in _ = self?.holder?.riderAnswered(true) }
        )
    }

    func showSwitching(_ mode: Mode) {
        screens.switching(rider: mode == .rider)
    }

    func fatal(_ failed: [String]) {
        stop(failed)
    }

    // PageSteps.

    func expose(_ mode: Mode?) {
        exposedMode = mode
    }

    func load(_ path: String) {
        loader.load(path)
    }

    func ready() {
        screens.hide()
    }

    // The native screens' answers.

    /// The device owner's authentication answered.
    func lockAnswered(_ passed: Bool) {
        guard let holder = holder else { return }
        if holder.lockAnswered(passed) { return }
        screens.hide()
        question.settle("notConfirmed")
    }

    private func stay() {
        // Between modes (the switching screen): nothing to stay in.
        guard let holder = holder, holder.current != nil else { return }
        unpairing.close()
        switch holder.pending {
        case .noLock: holder.noLockStay()
        case .riderQuestion: _ = holder.riderAnswered(false)
        default: break
        }
        screens.hide()
        question.settle("stayed")
    }

    /// The pairing screen went. In rider mode a pairing made goes on to the screen lock, as the key
    /// now would.
    private func pairingLeft(_ made: Bool) {
        guard made, let holder = holder, holder.current == .rider else {
            question.settle(made ? "paired" : "stayed")
            return
        }
        switch holder.askInstructor() {
        case .noLock?, .askLock?: break
        default: question.settle("stayed")
        }
    }

    // UnpairSteps. "Unpair": the page hears first, then the token and the classes go and
    // instructor mode closes.

    func showUnpairQuestion(stay: @escaping () -> Void, unpair: @escaping () -> Void) {
        screens.unpairQuestion(stay: stay, unpair: unpair)
    }

    func unpairStay() {
        stay()
    }

    func unpairAnswer(_ result: String) {
        screens.hide()
        question.settle(result)
    }

    func unpairNow() {
        pairing.service.unpair()
    }

    /// Every answer is checked once more: none may carry a token the device holds.
    private func answer(_ call: PageCall, _ data: [String: Any]) {
        if AnswerPolicy.mayAnswer(data, secrets()) {
            call.answer(data)
        } else {
            call.refuse()
        }
    }
}
