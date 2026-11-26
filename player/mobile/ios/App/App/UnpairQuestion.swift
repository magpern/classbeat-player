// Instructor mode's "Unpair this phone?" question (issue #925): the Swift twin of Android's
// UnpairQuestion.kt. It asks first, and only "Unpair" deletes anything: "Stay" and leaving the app
// keep the pairing. The page hears "unpaired" before anything is deleted. Pure: no import.

/// What the unpair question has the edge do. ModeController implements it.
protocol UnpairSteps: AnyObject {
    /// Shows the native "Unpair this phone?" question with its two keys.
    func showUnpairQuestion(stay: @escaping () -> Void, unpair: @escaping () -> Void)

    /// "Stay" or leaving the app: the edge's shared stay, which closes this question.
    func unpairStay()

    /// Takes the question down and answers the page's call with `result`.
    func unpairAnswer(_ result: String)

    /// Deletes the device token and the classes saved on this phone; instructor mode then closes.
    func unpairNow()
}

final class UnpairQuestion {
    private unowned let steps: UnpairSteps

    /// The question shows and has not been answered.
    private(set) var showing = false

    init(_ steps: UnpairSteps) {
        self.steps = steps
    }

    /// Shows the question; the edge has already refused it when anything else is open.
    func ask() {
        showing = true
        steps.showUnpairQuestion(
            stay: { [weak self] in self?.steps.unpairStay() },
            unpair: { [weak self] in self?.confirmed() }
        )
    }

    /// The question went another way (Stay, leaving the app, or the bridge closed): "Unpair" now
    /// does nothing.
    func close() {
        showing = false
    }

    /// "Unpair": once, and only while the question shows.
    private func confirmed() {
        guard showing else { return }
        showing = false
        steps.unpairAnswer("unpaired")
        steps.unpairNow()
    }
}
