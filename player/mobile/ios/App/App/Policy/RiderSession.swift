import Foundation

/// One answer or event for the page: a JSON object, or nil for the one refused word.
typealias RiderReply = ([String: Any]?) -> Void

// The rider's session in native code (issue #898, ADR 0011 sections 1 and 3): the Swift twin of
// Android's RiderSession.kt, tested with the same cases (AppTests/RiderSessionTests.swift). Pure:
// no UIKit, no storage, no I/O of its own; the transport does that.
//
// The rider token lives here, in memory only, from the join's answer until the session ends: it is
// never written anywhere, never in an answer or an event, and so never in the web view. Native code
// builds `hello` with it itself. The page joins, opens the live link, waits for what comes in
// (`receive`, one call at a time) and leaves; it never puts out a frame.
//
// The token is dropped when the rider leaves, the mode switches or the app goes (`drop`), the
// session ends (`ended`) and the live process refuses the token or closes the session (the final
// close codes). What comes in is checked against the rider-bound messages (RiderWire): anything
// else, a host event among them, never reaches the page. Every method runs on the main thread.
final class RiderSession {
    static let maxQueued = 64

    private let transport: RiderTransport
    private var token: String?
    private var link: RiderLink?
    private var joining = false

    /// Bumped on every ending: an answer or a link event from before it is stale.
    private var generation = 0
    private var queue: [[String: Any]] = []
    private var waiting: RiderReply?

    /// Told whenever `joined` may have changed (the idle timer follows it).
    var changed: () -> Void = {}

    init(transport: RiderTransport) {
        self.transport = transport
    }

    /// A token is held: the rider is in a class, or getting back in.
    var joined: Bool { token != nil }

    /// What no answer may carry: the token, while one is held.
    var secrets: [String] { token.map { [$0] } ?? [] }

    /// `POST /api/live/join`. The page hears joined, unreachable, or the server's status and error word.
    func join(_ session: String, _ nickname: String, _ reply: @escaping RiderReply) {
        if joined || joining || !RiderWire.sessionFits(session) || !RiderWire.nicknameFits(nickname) { return reply(nil) }
        joining = true
        let gen = generation
        transport.join(session, nickname) { [weak self] answer in
            guard let self = self, gen == self.generation else { return reply(nil) }
            self.joining = false
            reply(self.answerOf(answer))
        }
    }

    /// Opens the live link with the token held. Its events come through `receive`.
    func open(_ reply: @escaping RiderReply) {
        if !joined || link != nil { return reply(nil) }
        let events = Events(self, generation)
        let opened = transport.open(events)
        events.link = opened
        link = opened
        reply(["result": "opening"])
    }

    /// The next event, at once if one waits, else when one comes. One call at a time.
    func receive(_ reply: @escaping RiderReply) {
        if waiting != nil { return reply(nil) }
        if !queue.isEmpty {
            deliver(queue.removeFirst(), reply)
        } else if joined {
            waiting = reply
        } else {
            reply(nil)
        }
    }

    /// The rider's "Leave": the link closes and the token goes.
    func leave(_ reply: @escaping RiderReply) {
        drop()
        reply(["result": "left"])
    }

    /// Ends everything: on leave, on a mode switch and when the app goes. The waiting call is refused.
    func drop() {
        end()
        queue.removeAll()
        joining = false
        let w = waiting
        waiting = nil
        w?(nil)
    }

    private func end() {
        generation += 1
        link?.close()
        link = nil
        token = nil
        changed()
    }

    private func live(_ events: Events) -> Bool {
        events.generation == generation && link != nil && link === events.link
    }

    fileprivate func linkOpened(_ events: Events) {
        guard live(events), let t = token, let hello = RiderWire.hello(t) else { return }
        link?.transmit(hello)
        push(["kind": "opened"])
    }

    fileprivate func linkText(_ events: Events, _ frame: String) {
        guard live(events), frame.utf16.count <= RiderWire.maxFrameChars, RiderWire.riderBound(frame) else { return }
        push(["kind": "frame", "text": frame])
        // The session is over: the token goes now, and the page shows the ending it was sent.
        if RiderWire.type(frame) == "ended" { end() }
    }

    fileprivate func linkClosed(_ events: Events, _ code: Int) {
        guard live(events) else { return }
        link = nil
        push(["kind": "closed", "code": code])
        if RiderWire.finalCodes.contains(code) { end() }
    }

    private func push(_ event: [String: Any]) {
        if !AnswerPolicy.mayAnswer(event, secrets) { return }
        if let w = waiting {
            waiting = nil
            return deliver(event, w)
        }
        if queue.count >= Self.maxQueued {
            // A full queue loses its oldest passing event, never an ending (a close or `ended`): the
            // page must still hear how the class ended. With none to lose, a passing event is not kept.
            if let old = queue.firstIndex(where: { !Self.terminal($0) }) {
                queue.remove(at: old)
            } else if !Self.terminal(event) {
                return
            }
        }
        queue.append(event)
    }

    /// A close of the link, or the class's `ended`: what the page must hear to show the ending.
    private static func terminal(_ event: [String: Any]) -> Bool {
        let kind = event["kind"] as? String
        return kind == "closed" || (kind == "frame" && RiderWire.type(event["text"] as? String ?? "") == "ended")
    }

    private func deliver(_ event: [String: Any], _ reply: RiderReply) {
        reply(AnswerPolicy.mayAnswer(event, secrets) ? event : nil)
    }

    private func answerOf(_ answer: HttpAnswer) -> [String: Any]? {
        switch answer {
        case .unreachable:
            return ["result": "unreachable"]
        case let .http(status, body, _):
            if let t = RiderWire.tokenIn(status, body) {
                token = t
                changed()
                return ["result": "joined"]
            }
            // A 200 without a good token is "unexpected" to the page: no body goes with it.
            var word: Any = NSNull()
            if status != 200, let w = RiderWire.errorWord(body) { word = w }
            let out: [String: Any] = ["result": "answer", "status": status, "body": word]
            return AnswerPolicy.mayAnswer(out, []) ? out : nil
        }
    }
}

/// A link's events, live only while their session's generation and link are still theirs.
private final class Events: RiderLinkEvents {
    private weak var session: RiderSession?
    let generation: Int
    weak var link: RiderLink?

    init(_ session: RiderSession, _ generation: Int) {
        self.session = session
        self.generation = generation
    }

    func opened() {
        session?.linkOpened(self)
    }

    func text(_ frame: String) {
        session?.linkText(self, frame)
    }

    func closed(_ code: Int) {
        session?.linkClosed(self, code)
    }
}
