import XCTest
@testable import App

// The same cases as Android's PageQuestionTest.kt (issue #895): one question at a time. A second
// ask while one is open is refused, and the open question's call still gets its one answer. iOS has
// no unpair question yet, so both questions here are stand-ins wired as ModeController wires its own.
final class PageQuestionTests: XCTestCase {
    private final class Call {
        let name: String
        init(_ name: String) { self.name = name }
    }

    /// What each page call heard, and when the pairing was cleared.
    private var log: [String] = []
    private var question: PageQuestion<Call>!

    private var stayKey: () -> Void = {}
    private var unpairKey: () -> Void = {}
    private var unpairShowing = false
    private var riderShowing = false

    override func setUp() {
        super.setUp()
        log = []
        question = PageQuestion<Call>(
            resolve: { [unowned self] call, result in self.log.append("\(call.name) \(result)") },
            refuse: { [unowned self] call in self.log.append("\(call.name) refused") }
        )
        stayKey = {}
        unpairKey = {}
        unpairShowing = false
        riderShowing = false
    }

    /// The unpair question: Stay closes it and answers "stayed"; Unpair answers, then clears the pairing.
    private func askUnpair() {
        question.ask(Call("unpair")) {
            unpairShowing = true
            stayKey = { [unowned self] in
                guard self.unpairShowing else { return }
                self.unpairShowing = false
                self.question.settle("stayed")
            }
            unpairKey = { [unowned self] in
                guard self.unpairShowing else { return }
                self.unpairShowing = false
                self.question.settle("unpaired")
                self.log.append("pairing cleared")
            }
            return true
        }
    }

    private func askRider() {
        question.ask(Call("rider")) {
            riderShowing = true
            return true
        }
    }

    func testARiderAskDuringTheUnpairQuestionIsRefusedAndStayAnswersTheUnpairCall() {
        askUnpair()
        askRider()
        XCTAssertEqual(log, ["rider refused"])
        XCTAssertFalse(riderShowing)
        XCTAssertTrue(unpairShowing)
        stayKey()
        XCTAssertEqual(log, ["rider refused", "unpair stayed"])
        XCTAssertFalse(question.open)
    }

    func testARiderAskDuringTheUnpairQuestionIsRefusedAndUnpairAnswersThenClearsThePairing() {
        askUnpair()
        askRider()
        unpairKey()
        XCTAssertEqual(log, ["rider refused", "unpair unpaired", "pairing cleared"])
        XCTAssertFalse(question.open)
    }

    func testAnUnpairAskDuringTheRiderQuestionIsRefusedShowsNothingAndClearsNothing() {
        askRider()
        askUnpair()
        XCTAssertEqual(log, ["unpair refused"])
        XCTAssertFalse(unpairShowing)
        unpairKey()
        XCTAssertEqual(log, ["unpair refused"])
        question.settle("stayed")
        XCTAssertEqual(log, ["unpair refused", "rider stayed"])
    }

    func testARefusedShowRefusesTheCallAndHoldsNothing() {
        question.ask(Call("rider")) { false }
        XCTAssertFalse(question.open)
        askUnpair()
        stayKey()
        XCTAssertEqual(log, ["rider refused", "unpair stayed"])
    }

    func testAnAnswerThatComesBackWhileTheQuestionShowsReachesItsCallOnce() {
        question.ask(Call("instructor")) {
            question.settle("notConfirmed")
            return true
        }
        question.settle("stayed")
        XCTAssertEqual(log, ["instructor notConfirmed"])
        XCTAssertFalse(question.open)
    }

    func testDroppingAnswersTheOpenCallWithTheRefusedWordOnce() {
        askUnpair()
        question.drop()
        question.drop()
        question.settle("stayed")
        XCTAssertEqual(log, ["unpair refused"])
    }
}
