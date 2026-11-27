import XCTest
@testable import App

/// A rider transport in memory, as Android's FakeRiderTransport.kt: the test answers each join and
/// drives each link by hand. Nothing here reaches a network.
final class FakeRiderTransport: RiderTransport {
    private(set) var joins: [(session: String, nickname: String)] = []
    private var pending: [(HttpAnswer) -> Void] = []
    private(set) var links: [Link] = []

    func join(_ session: String, _ nickname: String, answer: @escaping (HttpAnswer) -> Void) {
        joins.append((session, nickname))
        pending.append(answer)
    }

    /// Answers the oldest join still waiting.
    func answerJoin(_ answer: HttpAnswer) {
        pending.removeFirst()(answer)
    }

    func open(_ events: RiderLinkEvents) -> RiderLink {
        let link = Link(events)
        links.append(link)
        return link
    }

    final class Link: RiderLink {
        let events: RiderLinkEvents
        private(set) var sent: [String] = []
        private(set) var closed = false

        init(_ events: RiderLinkEvents) {
            self.events = events
        }

        func transmit(_ text: String) {
            sent.append(text)
        }

        func close() {
            closed = true
        }
    }
}

enum RiderFixtures {
    /// A rider token of the contract's form, put together so no source holds one whole.
    static let token = "cbp_" + "rdr_" + String(repeating: "Ab3_-", count: 8) + "xyz"

    static let joinedAnswer = HttpAnswer.http(status: 200, body: ["riderToken": token], retryAfterS: nil)

    /// What the page is given, written out as the bridge would carry it: sorted keys, or "refused".
    static func written(_ data: [String: Any]?) -> String {
        guard let data = data,
              let bytes = try? JSONSerialization.data(withJSONObject: data, options: [.sortedKeys, .withoutEscapingSlashes]),
              let text = String(data: bytes, encoding: .utf8) else { return "refused" }
        return text
    }

    static func object(_ text: String) -> [String: Any]? {
        guard let data = text.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}
