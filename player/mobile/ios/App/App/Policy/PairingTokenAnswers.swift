// What the backend answers to the calls made with the device token (issue #896, split out of
// PairingProtocol.swift in issue #926): a token gone or run out, and the device's own row. Read as
// strictly as the pairing calls. Pure: no import.
extension PairingProtocol {
    enum Refusal: Equatable { case gone, expired }

    /// A 401 that says the token is gone for good or ran out; nil for any other answer.
    static func tokenRefusal(_ a: HttpAnswer) -> Refusal? {
        guard case let .http(status, body, _) = a, status == 401 else { return nil }
        switch field(body, "error") as? String {
        case "token_revoked", "token_unknown": return .gone
        case "token_expired": return .expired
        default: return nil
        }
    }

    enum Device: Equatable {
        case ok(name: String)
        case gone
        case expired
        case unknown
    }

    static func parseDevice(_ a: HttpAnswer) -> Device {
        switch tokenRefusal(a) {
        case .gone: return .gone
        case .expired: return .expired
        case nil: break
        }
        guard case let .http(status, body, _) = a, status == 200 else { return .unknown }
        guard let name = shownText(field(field(body, "device"), "name"), maxLabel) else { return .unknown }
        return .ok(name: name)
    }
}
