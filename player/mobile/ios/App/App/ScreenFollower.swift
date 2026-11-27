// The idle timer and the external display follow the mode, the page and the foreground (issue
// #897), and whether a rider is joined (issue #898). ModeController tells this what changed;
// KeepAwake and ExternalDisplay decide.
// Every method runs on the main thread. Pure: no import at all.

final class ScreenFollower {
    private let awake: KeepAwake
    private let display: ExternalDisplay
    private let riderJoined: () -> Bool

    /// The main-frame page last committed, and whether the app is in the foreground: the inputs of
    /// KeepAwake and ExternalDisplay besides the mode.
    private var page: String?
    private var foreground = false

    init(awake: KeepAwake, display: ExternalDisplay, riderJoined: @escaping () -> Bool) {
        self.awake = awake
        self.display = display
        self.riderJoined = riderJoined
    }

    /// The app opens in the foreground; UIKit sends no foreground event for the launch.
    func launched() {
        foreground = true
        display.start()
    }

    func committed(_ path: String) {
        page = path
    }

    func front(_ inFront: Bool, _ mode: Mode?) {
        foreground = inFront
        follow(mode)
    }

    /// Between modes: the screen is released at once, before the drops run.
    func between(_ mode: Mode?) {
        page = nil
        awake.release()
        display.update(mode, page, foreground: foreground)
    }

    func follow(_ mode: Mode?) {
        awake.sync(mode, page, riderJoined: riderJoined(), foreground: foreground)
        display.update(mode, page, foreground: foreground)
    }
}
