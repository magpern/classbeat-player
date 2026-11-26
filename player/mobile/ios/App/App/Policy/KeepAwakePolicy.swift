// When the phone's screen stays on (issue #897): the Swift twin of Android's KeepAwakePolicy.kt,
// tested with the same table (AppTests/KeepAwakePolicyTests.swift). Pure: no import at all. The
// idle timer itself is set by KeepAwake through ScreenFlag; this file only decides.
enum KeepAwakePolicy {
    /// The instructor page that is the open class (ModePolicy.pages: the list is the first page).
    static let classPage = "/room.html"

    /// Whether the screen stays on. Only in the foreground, and only for a class that is open
    /// (instructor mode on its class page) or a rider joined to a session (rider mode). Between
    /// modes (`mode` nil) it never does, and neither mode's state counts in the other mode.
    static func keepOn(_ mode: Mode?, _ path: String?, riderJoined: Bool, foreground: Bool) -> Bool {
        guard foreground else { return false }
        switch mode {
        case .instructor: return path == classPage
        case .rider: return riderJoined
        case nil: return false
        }
    }
}
