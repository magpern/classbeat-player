// The app's two modes and the rules between them (issue #895, ADR 0016 section 3, ADR 0011
// section 1): the Swift twin of Android's ModePolicy.kt, tested with the same table
// (AppTests/ModePolicyTests.swift). Pure: no import at all.

/// The app's two modes. `stored` is the value the mode store keeps; `plugin` the one plugin of the
/// mode the page may call.
enum Mode: CaseIterable {
    case rider, instructor

    var stored: String {
        switch self {
        case .rider: return "rider"
        case .instructor: return "instructor"
        }
    }

    var plugin: String {
        switch self {
        case .rider: return "RiderMode"
        case .instructor: return "InstructorMode"
        }
    }
}

enum ModePolicy {
    /// The way into instructor mode from rider mode.
    enum Entry: Equatable {
        /// Not paired: pairing comes first.
        case pair
        /// Paired, but no passcode: instructor mode cannot open, and the app says a passcode is needed.
        case noLock
        /// Paired with a passcode: the device owner's authentication is asked, every time.
        case askLock
    }

    /// The mode a launch may reopen: instructor mode only if it was the last one used and the
    /// device is still paired and has a passcode. Anything else, a first launch included, is rider.
    static func startMode(_ stored: String?, paired: Bool, secureLock: Bool) -> Mode {
        stored == Mode.instructor.stored && paired && secureLock ? .instructor : .rider
    }

    static func entry(paired: Bool, secureLock: Bool) -> Entry {
        if !paired { return .pair }
        if !secureLock { return .noLock }
        return .askLock
    }

    /// Instructor mode opens only on an asked and passed check, on a paired device with a passcode.
    static func opensInstructor(asked: Bool, passed: Bool, paired: Bool, secureLock: Bool) -> Bool {
        asked && passed && paired && secureLock
    }

    /// Each mode's bundled pages; the first is its start page. The two lists share no page.
    static func pages(_ mode: Mode) -> [String] {
        switch mode {
        case .rider: return ["/rider.html"]
        case .instructor: return ["/instructor.html", "/room.html"]
        }
    }

    static func startPage(_ mode: Mode) -> String {
        pages(mode)[0]
    }

    /// Whether a page at `path` may show in the main frame: only the current mode's pages, and
    /// none between modes.
    static func mayShow(_ mode: Mode?, _ path: String) -> Bool {
        guard let mode = mode else { return false }
        return pages(mode).contains(path)
    }

    /// What a switch drops, in this order, in both directions.
    static let teardown = ["follower", "connections", "instructorState", "riderSession", "riderNumbers", "webStorage"]
}
