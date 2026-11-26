// Keeps the room screen on the external display in step with ExternalDisplayPolicy (issue #897):
// the Swift twin of Android's ExternalDisplay.kt, tested with the same cases
// (AppTests/ExternalDisplayTests.swift). The phone's own screen is never touched here: taking the
// display's web view down leaves the class running on the phone. Every method runs on the main
// thread, and every call is idempotent. Pure: no import at all; the display scenes and their web
// view come in through the protocols below (DisplayScene.swift on a device).
//
// A dead web view is shown again at most once per show: a second crash with the same display,
// page and mode leaves the display down until one of them changes. The callbacks of a show that is
// no longer the current one are ignored.

/// The external displays connected now, as the presenter needs them.
protocol DisplaySource: AnyObject {
    /// The ids of the external displays connected now (AirPlay or a cable), never the phone's own.
    func presentationDisplays() -> [Int]

    /// Calls `changed` on the main thread whenever a display connects or goes away.
    func watch(_ changed: @escaping () -> Void)

    func stopWatching()
}

/// What shows the room screen on a display.
protocol RoomSurface: AnyObject {
    /// Shows `page` full screen on display `id`. `gone` is called if the system takes it down;
    /// `crashed` if its web view's content process died (the surface is then still up: dismiss it).
    func show(_ id: Int, _ page: String, gone: @escaping () -> Void, crashed: @escaping () -> Void)

    /// Shows `page` on the display it is already on, without taking it down.
    func load(_ page: String)

    /// Takes the room screen down and frees its web view.
    func dismiss()
}

final class ExternalDisplay {
    private struct Showing: Equatable {
        let display: Int
        let page: String
        let mode: Mode?
    }

    private let source: DisplaySource
    private let surface: RoomSurface
    private var shownOn: Int?
    private var shownPage: String?
    private var mode: Mode?
    private var path: String?
    private var foreground = false

    /// Counts the shows, so a callback can tell whether its show is still the current one.
    private var generation = 0

    /// The display, page and mode of the last crash, and whether it was shown again already.
    private var crashedAt: Showing?
    private var represented = false

    init(source: DisplaySource, surface: RoomSurface) {
        self.source = source
        self.surface = surface
    }

    /// Starts watching the displays.
    func start() {
        source.watch { [weak self] in self?.sync() }
    }

    /// The inputs of the policy, as the mode controller knows them.
    func update(_ mode: Mode?, _ path: String?, foreground: Bool) {
        self.mode = mode
        self.path = path
        self.foreground = foreground
        sync()
    }

    /// The app is going away: the room screen comes down and the displays are no longer watched.
    func stop() {
        source.stopWatching()
        hide()
    }

    private func sync() {
        let display = source.presentationDisplays().first
        let page = ExternalDisplayPolicy.shown(mode, path, displayPresent: display != nil, foreground: foreground).page
        guard let display = display, let page = page else {
            hide()
            return
        }
        let wanted = Showing(display: display, page: page, mode: mode)
        if crashedAt != nil && crashedAt != wanted {
            // A change of display, page or mode: a new show, with its own re-show.
            crashedAt = nil
            represented = false
        }
        if represented && crashedAt == wanted && shownOn == nil { return }
        if shownOn == display {
            if shownPage != page {
                surface.load(page)
                shownPage = page
            }
            return
        }
        hide()
        shownOn = display
        shownPage = page
        generation += 1
        let show = generation
        surface.show(
            display,
            page,
            gone: { [weak self] in if let self = self, show == self.generation { self.lost() } },
            crashed: { [weak self] in if let self = self, show == self.generation { self.crashed() } }
        )
    }

    /// The system took it down: not shown; the next display or page event decides again.
    private func lost() {
        generation += 1
        shownOn = nil
        shownPage = nil
    }

    /// The web view died: take it down and, the first time for this display, page and mode, show it
    /// again if the policy still says so. The second time it stays down.
    private func crashed() {
        guard let display = shownOn, let page = shownPage else { return }
        let at = Showing(display: display, page: page, mode: mode)
        represented = crashedAt == at
        crashedAt = at
        hide()
        sync()
    }

    private func hide() {
        guard shownOn != nil else { return }
        generation += 1
        shownOn = nil
        shownPage = nil
        surface.dismiss()
    }
}
