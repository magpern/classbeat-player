// The iOS side of the mode holder (issue #895): it puts the current mode's plugin on the bridge,
// loads the mode's pages and no other, shows the native screens and asks the device owner's
// authentication. It also keeps the idle timer and the external display in step with the mode,
// the page and the foreground (issue #897). The holder and the policies decide; this only carries
// it out, as Android's ModeController.kt.
// Every method runs on the main thread. Pure: no import at all; the screen lock, the screens and
// the web view come in through the protocols below, so the tests fake every one of them
// (AppTests/ModeControllerTests.swift).

/// The device owner's authentication (LocalAuthentication on a device, a fake in the tests).
protocol ScreenLock: AnyObject {
    /// The device has a passcode. Read again at every decision.
    var isSet: Bool { get }

    /// Asks the device owner's authentication, afresh every time; `done` hears whether it passed.
    func ask(_ done: @escaping (Bool) -> Void)
}

/// The native screens over the page.
protocol ModeScreens: AnyObject {
    /// "A passcode is needed": instructor mode cannot open without one.
    func noLock(stay: @escaping () -> Void)

    /// "Switch to rider mode?"
    func riderQuestion(stay: @escaping () -> Void, switch: @escaping () -> Void)

    /// The switching screen while a switch runs.
    func switching(rider: Bool)

    /// Takes down whatever native screen shows.
    func hide()
}

/// Loads a bundled page in the web view's main frame.
protocol PageLoader: AnyObject {
    func load(_ path: String)
}

/// A call from the page, answered once.
protocol PageCall: AnyObject {
    func answer(_ data: [String: Any])
    func refuse()
}

final class ModeController: ModeEffects, PageSteps {
    private final class Held {
        let call: PageCall
        init(_ call: PageCall) { self.call = call }
    }

    private let lock: ScreenLock
    private let screens: ModeScreens
    private let loader: PageLoader
    private let awake: KeepAwake
    private let display: ExternalDisplay
    private let secrets: () -> [String]
    private let stop: ([String]) -> Void
    private var holder: ModeHolder?
    private lazy var opener = PageOpener(self)
    private var question: PageQuestion<Held>!

    /// The mode whose plugin is on the bridge; nil while none is.
    private var exposedMode: Mode?

    /// The main-frame page last committed, and whether the app is in the foreground: the inputs of
    /// KeepAwake and ExternalDisplay besides the mode (issue #897).
    private var page: String?
    private var foreground = false

    /// `secrets` are the tokens the device holds, which no answer may carry; `stop` ends the app
    /// when a switch could not drop everything.
    init(
        lock: ScreenLock,
        screens: ModeScreens,
        loader: PageLoader,
        awake: KeepAwake,
        display: ExternalDisplay,
        secrets: @escaping () -> [String] = { [] },
        stop: @escaping ([String]) -> Void
    ) {
        self.lock = lock
        self.screens = screens
        self.loader = loader
        self.awake = awake
        self.display = display
        self.secrets = secrets
        self.stop = stop
        question = PageQuestion<Held>(
            resolve: { [weak self] held, word in self?.answer(held.call, ["result": word]) },
            refuse: { held in held.call.refuse() }
        )
    }

    /// Opens the app in rider mode. Throws if the parts are not the ones ModePolicy.teardown names.
    func start(device: Device, store: ModeStore, parts: [Teardown]) throws {
        let holder = try ModeHolder(store: store, device: device, effects: self, parts: parts)
        self.holder = holder
        // The app opens in the foreground; UIKit sends no foreground event for the launch.
        foreground = true
        display.start()
        holder.start()
        follow()
    }

    var current: Mode? { holder?.current }

    /// The one plugin the page may call now, by name; nil while none may.
    var exposed: String? { exposedMode?.plugin }

    // The web view's gate: asked before any main-frame page loads, told when one commits.

    func mayShow(_ path: String) -> Bool {
        opener.mayShow(path) ?? ModePolicy.mayShow(current, path)
    }

    func shown(_ path: String) {
        page = path
        opener.committed(path)
        follow()
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
                switch holder.askInstructor() {
                case nil:
                    return false
                case .pair:
                    // No pairing on iOS yet: the page hears that the phone is not paired.
                    question.settle("unpaired")
                    return true
                case .noLock, .askLock:
                    return true
                }
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

    /// Back in the app: a passcode may have been set meanwhile.
    func resumed() {
        foreground = true
        follow()
        guard let holder = holder, holder.pending == .noLock else { return }
        holder.noLockReturned()
        // No longer paired: nothing to ask, so the screen goes and the page hears so.
        if holder.pending == nil {
            screens.hide()
            question.settle("unpaired")
        }
    }

    /// Leaving the app while the rider question shows means "Stay".
    func stopped() {
        foreground = false
        follow()
        if holder?.pending == .riderQuestion { stay() }
    }

    /// The pairing's token was deleted (unpaired, revoked or unknown on the site): instructor mode closes.
    func unpaired() {
        holder?.unpaired()
    }

    // ModeEffects.

    func closeBridge() {
        expose(nil)
        // Between modes: the screen is released at once, before the drops run.
        page = nil
        awake.release()
        display.update(current, page, foreground: foreground)
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
        switch holder.pending {
        case .noLock: holder.noLockStay()
        case .riderQuestion: _ = holder.riderAnswered(false)
        default: break
        }
        screens.hide()
        question.settle("stayed")
    }

    /// The idle timer and the external display follow the pure decisions. iOS has no rider session
    /// yet, so no rider is ever joined.
    private func follow() {
        awake.sync(current, page, riderJoined: false, foreground: foreground)
        display.update(current, page, foreground: foreground)
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
