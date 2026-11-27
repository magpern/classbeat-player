// One line of a native screen, as words only (issue #925): the Swift twin of Android's
// ScreenLine.kt. Pure: no import; the screens' models build these and the UIKit edge draws them.
enum ScreenLine: Equatable {
    /// The mode tag: "Rider mode" or "Instructor mode".
    case tag(String)
    case title(String)
    case text(String)
    /// A grey note.
    case note(String)
    /// The still, hollow working marker and its words.
    case working(String)
    /// The pairing code on its raised panel labelled "Code": the largest text on the screen.
    case code(String)
    /// A numbered step.
    case step(Int, String)
    /// A white plate: what happened, then what to do.
    case plate(head: String, body: String)

    /// The line's kind, so a screen changes words in place only where the kinds match.
    var kind: Int {
        switch self {
        case .tag: return 0
        case .title: return 1
        case .text: return 2
        case .note: return 3
        case .working: return 4
        case .code: return 5
        case .step: return 6
        case .plate: return 7
        }
    }

    /// The words as drawn, with Android's markers.
    var words: String {
        switch self {
        case let .tag(w): return "●  " + w
        case let .note(w): return "□  " + w
        // The hollow working marker, still: it does not spin (app-pairing.md, motion).
        case let .working(w): return "○  " + w
        case let .title(w), let .text(w), let .code(w): return w
        case let .step(n, w): return "\(n).  " + w
        case let .plate(head, body): return head + "\n" + body
        }
    }
}
