import Foundation

// What shows on the external display (issue #897): the Swift twin of Android's
// ExternalDisplayPolicy.kt (issue #738), tested with the same table
// (AppTests/ExternalDisplayPolicyTests.swift). Pure: Foundation's URL parsing only. The display
// scenes and their windows are DisplayScene.swift's; this file only decides.
//
// The room screen opens a class only through the bridge, and the display's web view has no bridge,
// so the display keeps the idle stage while a class runs on the phone.
enum ExternalDisplayPolicy {
    /// The dark stage with its one line (display.html: no bridge, no data).
    static let idlePage = "/display.html"

    /// The same stage with the rider's line, for rider mode. Chosen by the mode alone.
    static let idleRiderPage = "/display-rider.html"

    enum Shown: CaseIterable, Equatable {
        /// No web view on the display (the scene's own black window stays: never a mirror).
        case none
        /// Instructor mode, with or without a class open on the phone, and between modes.
        case idle
        /// Rider mode: the idle stage with "Your class is on your phone".
        case idleRider

        var page: String? {
            switch self {
            case .none: return nil
            case .idle: return ExternalDisplayPolicy.idlePage
            case .idleRider: return ExternalDisplayPolicy.idleRiderPage
            }
        }
    }

    /// What the external display shows. With a display connected and the app in the foreground,
    /// always a page of our own: the idle stage, with the rider's line in rider mode and the
    /// instructor's otherwise, a class open on the phone, the app between modes (`mode` nil) and
    /// before any page committed (`path` nil) included. `path` does not change what shows; it stays
    /// an input so the caller need not know that. The background shows nothing.
    static func shown(_ mode: Mode?, _ path: String?, displayPresent: Bool, foreground: Bool) -> Shown {
        if !displayPresent || !foreground { return .none }
        return mode == .rider ? .idleRider : .idle
    }

    /// Whether the display's web view may load `url`: the bundle's own files only, and in the main
    /// frame an idle page only. Inner frames may load any bundle file (the page's CSP allows none);
    /// there is no link or other page to go to.
    static func mayLoad(_ url: String, mainFrame: Bool) -> Bool {
        guard NavigationPolicy.serves(url) else { return false }
        if !mainFrame { return true }
        guard let raw = URLComponents(string: url)?.percentEncodedPath,
              let path = NavigationPolicy.decodePath(raw) else { return false }
        return path == idlePage || path == idleRiderPage
    }
}
