// Rider mode's live intents on the bridge (issue #898), as Android's RiderBridge.kt: each call goes
// to RiderSession, which keeps the rider token to itself. An answer or event that comes after rider
// mode closed is refused, never sent to the next mode's page; one that does go is put through the
// controller's last check, which also holds the token. iOS has no hardware Back, so the page's own
// "Leave" is the only way out. Every method runs on the main thread. Pure: no import at all.
final class RiderBridge {
    private let session: RiderSession
    private let live: () -> Bool
    private let answer: (PageCall, [String: Any]) -> Void

    /// `live` says whether rider mode's plugin is still the one on the bridge; `answer` is the
    /// controller's checked answer.
    init(session: RiderSession, live: @escaping () -> Bool, answer: @escaping (PageCall, [String: Any]) -> Void) {
        self.session = session
        self.live = live
        self.answer = answer
    }

    /// Whether a rider is joined.
    var joined: Bool { session.joined }

    /// The token, while one is held: no answer may carry it.
    var secrets: [String] { session.secrets }

    /// Told whenever `joined` may have changed.
    var changed: () -> Void {
        get { session.changed }
        set { session.changed = newValue }
    }

    /// One of join, open, receive and leave; IntentPolicy has checked the arguments' types,
    /// RiderSession checks their form.
    func handle(_ name: String, _ args: [String: Any], _ call: PageCall) {
        let reply = self.reply(call)
        switch name {
        case "join": session.join(args["session"] as? String ?? "", args["nickname"] as? String ?? "", reply)
        case "open": session.open(reply)
        case "receive": session.receive(reply)
        case "leave": session.leave(reply)
        default: call.refuse()
        }
    }

    /// Drops the session: on a mode switch and when the app goes.
    func drop() {
        session.drop()
    }

    private func reply(_ call: PageCall) -> RiderReply {
        return { [weak self] data in
            guard let self = self, let data = data, self.live() else { return call.refuse() }
            self.answer(call, data)
        }
    }
}
