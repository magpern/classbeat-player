// The one page call a native question answers (issue #895): the Swift twin of Android's
// PageQuestion.kt, tested with the same cases (AppTests/PageQuestionTests.swift). Only one question
// is open at a time. A call that arrives while one is open is refused at once and changes nothing:
// the open question stays as it is and its own call still gets its answer, so no call is ever left
// without one. `resolve` answers a call with a result word, `refuse` with the one refused word.
// Pure: no import at all.
final class PageQuestion<Call: AnyObject> {
    private let resolve: (Call, String) -> Void
    private let refuse: (Call) -> Void
    private var waiting: Call?

    init(resolve: @escaping (Call, String) -> Void, refuse: @escaping (Call) -> Void) {
        self.resolve = resolve
        self.refuse = refuse
    }

    /// A question is open and its call not yet answered.
    var open: Bool { waiting != nil }

    /// Holds `call` and runs `show`, the question's own checks and its screen. `show` returns false
    /// when it refused, and the call is then refused and nothing held. The call is held before
    /// `show` runs, so an answer that comes back at once still reaches it.
    func ask(_ call: Call, _ show: () -> Bool) {
        if waiting != nil {
            refuse(call)
            return
        }
        waiting = call
        if show() { return }
        if waiting === call {
            waiting = nil
            refuse(call)
        }
    }

    /// The question was answered: its call hears `result`, once.
    func settle(_ result: String) {
        guard let call = waiting else { return }
        waiting = nil
        resolve(call, result)
    }

    /// The page that asked is being replaced: its call hears the refused word, once.
    func drop() {
        guard let call = waiting else { return }
        waiting = nil
        refuse(call)
    }
}
