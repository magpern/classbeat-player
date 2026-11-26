// Carries out KeepAwakePolicy's decision on the idle timer (issue #897): the Swift twin of
// Android's KeepAwake.kt. It decides nothing itself. Pure: no import at all; the idle timer comes in
// through ScreenFlag (AppIdleTimer in DisplayScene.swift, a fake in AppTests/KeepAwakeTests.swift).

/// The screen's keep-on flag, as KeepAwake needs it.
protocol ScreenFlag: AnyObject {
    /// Sets the flag when `on`, clears it otherwise.
    func keepOn(_ on: Bool)
}

final class KeepAwake {
    private let flag: ScreenFlag

    init(_ flag: ScreenFlag) {
        self.flag = flag
    }

    /// The flag follows the policy for these inputs.
    func sync(_ mode: Mode?, _ page: String?, riderJoined: Bool, foreground: Bool) {
        flag.keepOn(KeepAwakePolicy.keepOn(mode, page, riderJoined: riderJoined, foreground: foreground))
    }

    /// The flag is cleared at once, whatever the policy would say (between modes).
    func release() {
        flag.keepOn(false)
    }
}
