import XCTest
@testable import App

// Each intent's fixed answer on iOS (issue #895): the same words as Android's, and no token in any.
final class IntentAnswersTests: XCTestCase {
    private func json(_ value: [String: Any]?) -> String? {
        guard let value = value,
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func testEachIntentHasItsFixedAnswerOrNone() {
        let expected: [String: String?] = [
            "instructorWay": nil,
            "askInstructorMode": nil,
            "askRiderMode": nil,
            "open": nil,
            "receive": nil,
            "unpair": nil,
            "pairAgain": nil,
            "join": #"{"result":"unreachable"}"#,
            "leave": #"{"result":"left"}"#,
            "listClasses": #"{"classes":[],"status":"unavailable"}"#,
            "syncNow": #"{"classes":[],"status":"unavailable"}"#,
            "getClass": #"{"error":"not_found"}"#,
            "followAccess": #"{"granted":false,"state":"unavailable"}"#,
            "follow": #"{"state":"unavailable"}"#,
            "unfollow": #"{"state":"stopped"}"#,
            "reading": #"{"state":"stopped"}"#,
            "sendPlay": #"{"state":"stopped"}"#,
            "sendPause": #"{"state":"stopped"}"#,
            "sendNext": #"{"state":"stopped"}"#,
            "openFollowSetting": #"{"state":"notOpened"}"#,
        ]
        // Every intent is listed here, so a new one fails until its answer is decided.
        XCTAssertEqual(Set(expected.keys), Set(IntentPolicy.intents.keys))
        for (name, answer) in expected {
            XCTAssertEqual(json(IntentAnswers.fixed(name)), answer, name)
        }
    }

    func testAnUnknownNameHasNoAnswer() {
        for name in ["", "setMode", "unlock", "Follow", "play"] {
            XCTAssertNil(IntentAnswers.fixed(name), name)
        }
    }

    func testNoFixedAnswerCarriesAToken() {
        for name in IntentPolicy.intents.keys {
            guard let answer = IntentAnswers.fixed(name) else { continue }
            XCTAssertTrue(AnswerPolicy.mayAnswer(answer, [Secrets.token(), Secrets.deviceCode()]), name)
            XCTAssertFalse(json(answer)?.lowercased().contains("token") ?? true, name)
        }
    }
}
