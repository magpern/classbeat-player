// How rider mode would reach the live process (issue #898, ADR 0011 sections 1 and 3), as a
// contract: the Swift twin of Android's RiderTransport.kt, with the join request and the rider's
// live link (open, one text frame out, close). Pure: no import at all; the I/O would live in an
// implementation.
//
// An implementation calls only the backend origin fixed in the build and its live paths, puts out
// what it is given and nothing else, never follows a redirect, never throws and never logs. It
// answers on the main thread, later, never from inside the call that started it. Every failure is
// `.unreachable` for the join, and `closed(RiderClose.lost)` for the link.
//
// iOS has no live transport: it waits for the owner (ADR 0016 section 4), so the app wires
// OfflineRiderTransport and the tests a fake.

protocol RiderTransport: AnyObject {
    /// `POST /api/live/join` with exactly `{session, nickname}`.
    func join(_ session: String, _ nickname: String, answer: @escaping (HttpAnswer) -> Void)

    /// Opens the rider's live link. `events` hears of it only after this returns.
    func open(_ events: RiderLinkEvents) -> RiderLink
}

enum RiderClose {
    /// The close code for a link that was lost or never opened (no close frame came).
    static let lost = 1006
}

/// One open (or opening) live link. After `close` its events hear nothing more.
protocol RiderLink: AnyObject {
    /// Puts out one text frame.
    func transmit(_ text: String)

    /// Closes the link; no event follows.
    func close()
}

/// What a link tells the session.
protocol RiderLinkEvents: AnyObject {
    func opened()
    func text(_ frame: String)
    func closed(_ code: Int)
}

/// The stand-in the app runs while there is no live transport: every join and every link is
/// offline, answered on a later turn.
final class OfflineRiderTransport: RiderTransport {
    private let post: (@escaping () -> Void) -> Void

    init(post: @escaping (@escaping () -> Void) -> Void) {
        self.post = post
    }

    func join(_ session: String, _ nickname: String, answer: @escaping (HttpAnswer) -> Void) {
        post { answer(.unreachable) }
    }

    func open(_ events: RiderLinkEvents) -> RiderLink {
        let link = OfflineLink()
        post { if !link.shut { events.closed(RiderClose.lost) } }
        return link
    }

    private final class OfflineLink: RiderLink {
        var shut = false

        func transmit(_ text: String) {}

        func close() {
            shut = true
        }
    }
}
