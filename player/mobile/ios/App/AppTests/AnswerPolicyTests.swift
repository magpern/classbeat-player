import XCTest
@testable import App

// The same table as Android's AnswerPolicyTest.kt (issue #895).
final class AnswerPolicyTests: XCTestCase {
    private let secrets = [Secrets.token("Q"), Secrets.deviceCode("R")]

    func testAnAnswerWithNoSecretMayGo() {
        XCTAssertTrue(AnswerPolicy.mayAnswer(["classes": [["title": "Alpha"]], "status": "synced"], secrets))
        XCTAssertTrue(AnswerPolicy.mayAnswer(nil, []))
    }

    func testASecretAnywhereWholeOrInPartIsRefused() {
        for s in secrets {
            let chars = Array(s)
            XCTAssertFalse(AnswerPolicy.mayAnswer(["a": s], secrets))
            XCTAssertFalse(AnswerPolicy.mayAnswer(["a": [["b": "x" + String(chars[9..<21]) + "y"]]], secrets))
            XCTAssertFalse(AnswerPolicy.mayAnswer([String(chars.suffix(12)): 1], secrets))
        }
    }

    func testAnAnswerThatCannotBeWrittenIsRefused() {
        XCTAssertFalse(AnswerPolicy.mayAnswer(["a": NSObject()], secrets))
    }
}

/// A secret built at run time, so no token-shaped text sits in the sources (the CI secret scan).
enum Secrets {
    static func token(_ c: Character = "A") -> String { "cbp_" + "dev_" + String(repeating: c, count: 43) }

    static func deviceCode(_ c: Character = "B") -> String { "cbp_" + "dc_" + String(repeating: c, count: 43) }
}
