// The native pairing screen's logic (issue #925, docs/design/app-pairing-ios.md): it starts a
// pairing, shows PairingScreenModel's screen for each state and counts the code down once a second.
// Opened from rider mode's "Switch to instructor mode" on an unpaired phone, or by "pair again" in
// instructor mode. The Swift twin of Android's PairingUi.kt. Main thread only. Pure: no import; the
// screen and the one-second tick come in through the protocols below, so the tests fake both.

/// Draws the pairing screen over the page (PairingScreenView on the phone).
protocol PairingScreens: AnyObject {
    /// Shows `screen` anew; each key calls `press` with its action.
    func show(_ screen: PairingScreenModel.Screen, press: @escaping (PairingScreenModel.Action) -> Void)

    /// Changes the words in place when the lines are of the same kinds, so the focus stays where it
    /// is (the countdown). False when it could not, and the screen is then shown anew.
    func retext(_ screen: PairingScreenModel.Screen) -> Bool

    /// Takes the pairing screen down.
    func hide()
}

/// A tick once a second while a code shows (a Timer on the phone).
protocol Ticker: AnyObject {
    /// Starts ticking, replacing any tick already running.
    func start(_ tick: @escaping () -> Void)
    func stop()
}

final class PairingUi {
    let service: PairingService
    private let ports: PairingPorts
    private let screens: PairingScreens
    private let ticker: Ticker

    private(set) var showing = false
    private var instructor = false
    private var returned = false
    private var shown: PairingScreenModel.Screen?
    private var leave: (Bool) -> Void = { _ in }

    init(service: PairingService, ports: PairingPorts, screens: PairingScreens, ticker: Ticker) {
        self.service = service
        self.ports = ports
        self.screens = screens
        self.ticker = ticker
        service.changed = { [weak self] in self?.changed() }
    }

    /// Shows the screen and starts a pairing; `leave` runs once when the screen goes, with whether a
    /// pairing was made.
    func open(instructor: Bool, leave: @escaping (Bool) -> Void) {
        self.instructor = instructor
        self.leave = leave
        returned = false
        shown = nil
        showing = true
        // A notice (unpaired on the website, say) stays on its plate; "Start again" begins.
        if PairingScreenModel.begins(service.view()) {
            service.begin()
        }
        render()
    }

    /// After every pairing change.
    func changed() {
        if showing { render() }
    }

    /// The app went to the background: nothing is asked of the server until it comes back.
    func stopped() {
        service.stopped()
    }

    /// The app came back, from Safari or anywhere: a code still waiting gets the waiting line and
    /// the server is asked at once (the service's resumed redraws through `changed`).
    func resumed() {
        if showing, case .waiting = service.view() { returned = true }
        service.resumed()
        if showing { render() }
    }

    /// The edge swipe is "Cancel" on every pairing screen.
    func back() {
        close(false)
    }

    /// Closes the screen with no answer to anyone: the page that opened it is being replaced. A
    /// "pair again" whose token could not be kept closes instructor mode, and its plate stays over
    /// rider mode so the user learns why (issue #926); its keys then lead from rider mode, and a
    /// pairing made there goes on to instructor mode as from rider mode's own way in. Only then:
    /// a screen opened from rider mode closes as before.
    func drop() {
        guard showing else { return }
        if instructor, case .unpaired(notice: .saveFailed) = service.view() {
            instructor = false
            render()
            return
        }
        service.cancel()
        service.seen()
        showing = false
        ticker.stop()
        screens.hide()
    }

    private func press(_ action: PairingScreenModel.Action) {
        guard showing else { return }
        switch action {
        case .cancel, .rider:
            close(false)
        case .open:
            // The only way the page opens. With no browser the screen still shows the code and the
            // address, to type in on another device.
            if case let .waiting(_, page, _) = service.view() { _ = ports.openPage(page) }
        // Checks again from the start, the Keychain too: a passcode may have been set meanwhile.
        case .startAgain:
            returned = false
            service.begin()
        case .proceed:
            close(true)
        }
    }

    private func close(_ made: Bool) {
        guard showing else { return }
        // Stops an attempt that is still running; a pairing already made is kept.
        service.cancel()
        service.seen()
        showing = false
        ticker.stop()
        screens.hide()
        leave(made)
    }

    private func render() {
        let view = service.view()
        let screen = PairingScreenModel.screen(view, now: ports.now(), returned: returned, instructor: instructor)
        // The countdown changes in place, so the focus stays on its key; anything else shows anew.
        if shown?.keys != screen.keys || shown?.lines.map({ $0.kind }) != screen.lines.map({ $0.kind }) || !screens.retext(screen) {
            screens.show(screen) { [weak self] action in self?.press(action) }
        }
        shown = screen
        if case .waiting = view {
            ticker.start { [weak self] in self?.changed() }
        } else {
            ticker.stop()
        }
    }
}
