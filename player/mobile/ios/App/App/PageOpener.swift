// Puts a mode's start page up without letting any other page reach that mode's intents (issue
// #895): the Swift twin of Android's PageOpener.kt, tested with the same cases
// (AppTests/PageOpenerTests.swift). The last mode's page keeps running until a new document
// commits, so a mode's plugin goes on the bridge only once the blank page, which runs no script of
// ours, has replaced it:
//
// 1. every plugin off, then load the blank page;
// 2. the blank page committed: the last page is gone, so put the mode's plugin on and load its start page;
// 3. the start page committed: PageSteps.ready.
//
// Pure: no import at all. The edge calls it on the main thread only.

/// What the opener has the bridge and the web view do. The iOS edge implements it (ModeController).
protocol PageSteps: AnyObject {
    /// Puts `mode`'s plugin, and only that one, on the bridge; nil takes every plugin off.
    func expose(_ mode: Mode?)

    /// Loads the bundled page at `path` in the main frame.
    func load(_ path: String)

    /// The mode's start page has committed: the native screen can go.
    func ready()
}

final class PageOpener {
    /// The bundled blank page: no script or style of ours.
    static let blank = "/index.html"

    private enum Stage {
        /// Waiting for the blank page to commit. Every plugin is off.
        case clearing(Mode)

        /// The blank page is up and the mode's plugin on; waiting for its start page to commit.
        case starting(Mode)
    }

    private unowned let steps: PageSteps
    private var stage: Stage?

    init(_ steps: PageSteps) {
        self.steps = steps
    }

    /// Opens `mode`'s start page fresh, by way of the blank page.
    func open(_ mode: Mode) {
        stage = .clearing(mode)
        steps.expose(nil)
        steps.load(Self.blank)
    }

    /// Whether a main-frame page at `path` may load. While the last page is being cleared only the
    /// blank page may, so no page of either mode can take its place; otherwise nil, and
    /// ModePolicy.mayShow decides.
    func mayShow(_ path: String) -> Bool? {
        if case .clearing = stage { return path == Self.blank }
        return nil
    }

    /// A main-frame page at `path` committed.
    func committed(_ path: String) {
        switch stage {
        case .clearing(let mode):
            if path == Self.blank {
                stage = .starting(mode)
                steps.expose(mode)
                steps.load(ModePolicy.startPage(mode))
            }
        case .starting(let mode):
            if path == ModePolicy.startPage(mode) {
                stage = nil
                steps.ready()
            }
        case nil:
            break
        }
    }
}
