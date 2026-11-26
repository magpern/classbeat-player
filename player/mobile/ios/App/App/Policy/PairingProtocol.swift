import Foundation

// What the backend answers to the pairing calls (issue #896, ADR 0016 section 4), read strictly:
// the Swift twin of Android's PairingProtocol.kt. Anything not exactly an expected answer is
// "unexpected": the app never guesses. Pure: Foundation's JSON types and regular expressions only.
enum PairingProtocol {
    private static let secret = "[A-Za-z0-9_-]{43}"
    private static let deviceCode = "cbp_dc_" + secret
    private static let deviceToken = "cbp_dev_" + secret
    private static let userCode = "[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}"
    private static let hidden = "[\\p{C}\\u2028\\u2029]"

    static let minIntervalS = 5
    private static let maxIntervalS = 60
    private static let maxExpiresS = 3600
    static let maxEmail = 320
    static let maxLabel = 40

    static func isDeviceToken(_ v: Any?) -> Bool {
        guard let s = v as? String else { return false }
        return WholeMatch.matches(s, deviceToken)
    }

    static func field(_ body: Any?, _ key: String) -> Any? {
        (body as? [String: Any])?[key]
    }

    /// A JSON whole number in range; a JSON true or false is not a number here.
    private static func wholeNumber(_ v: Any?, _ min: Int, _ max: Int) -> Int? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        guard d == d.rounded(.down), d >= Double(min), d <= Double(max) else { return nil }
        return Int(d)
    }

    /// Text from the server a person will read: no control or format characters, 1 to `max` long.
    static func shownText(_ v: Any?, _ max: Int) -> String? {
        guard let s = v as? String, s.utf16.count <= 10 * max else { return nil }
        let kept = s.replacingOccurrences(of: hidden, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let n = kept.utf16.count
        return n >= 1 && n <= max ? kept : nil
    }

    enum Start: Equatable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
        case started(deviceCode: String, userCode: String, page: String, expiresInMs: Int, intervalMs: Int)
        case tooMany
        case unreachable
        case unexpected

        var description: String {
            switch self {
            case .started(_, let userCode, _, _, _): return "Started(\(userCode))"
            case .tooMany: return "TooMany"
            case .unreachable: return "Unreachable"
            case .unexpected: return "Unexpected"
            }
        }

        var debugDescription: String { description }
        var customMirror: Mirror { Mirror(self, children: ["start": description]) }
    }

    static func parseStart(_ a: HttpAnswer, _ origin: String) -> Start {
        guard case let .http(status, body, _) = a else { return .unreachable }
        if status == 429 { return .tooMany }
        if status >= 500 { return .unreachable }
        if status != 200 { return .unexpected }
        let code = field(body, "device_code") as? String
        let user = field(body, "user_code") as? String
        let page = OriginPolicy.pairingPageOn(origin, field(body, "verification_uri"))
        let expires = wholeNumber(field(body, "expires_in"), 1, maxExpiresS)
        let interval = wholeNumber(field(body, "interval"), 1, maxIntervalS)
        guard let code = code, WholeMatch.matches(code, deviceCode) else { return .unexpected }
        guard let user = user, WholeMatch.matches(user, userCode) else { return .unexpected }
        guard let page = page, let expires = expires, let interval = interval else { return .unexpected }
        // Never faster than the 5 s the protocol allows, whatever the answer says.
        return .started(
            deviceCode: code, userCode: user, page: page,
            expiresInMs: expires * 1000, intervalMs: Swift.max(interval, minIntervalS) * 1000
        )
    }

    enum Poll: Equatable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
        case ok(token: String, email: String?)
        case refused(String)
        /// No answer, a server fault or a rate limit: ask again later.
        case retry(afterMs: Int?)
        case unexpected

        var description: String {
            switch self {
            case .ok: return "Ok"
            case .refused(let code): return "Refused(\(code))"
            case .retry(let afterMs): return "Retry(\(afterMs.map(String.init) ?? "nil"))"
            case .unexpected: return "Unexpected"
            }
        }

        var debugDescription: String { description }
        var customMirror: Mirror { Mirror(self, children: ["poll": description]) }
    }

    static let pending = "authorization_pending"
    static let slowDown = "slow_down"
    static let denied = "access_denied"
    static let expired = "expired_token"
    private static let refusals: Set<String> = [pending, slowDown, denied, expired]

    static func parsePoll(_ a: HttpAnswer) -> Poll {
        guard case let .http(status, body, retryAfterS) = a else { return .retry(afterMs: nil) }
        if status == 429 || status >= 500 { return .retry(afterMs: retryAfterS.map { $0 * 1000 }) }
        if status == 400 {
            if let code = field(body, "error") as? String, refusals.contains(code) { return .refused(code) }
            return .unexpected
        }
        if status != 200 { return .unexpected }
        guard let map = body as? [String: Any], let raw = map["email"] else { return .unexpected }
        var email: String?
        if !(raw is NSNull) {
            guard let shown = shownText(raw, maxEmail) else { return .unexpected }
            email = shown
        }
        guard let token = map["device_token"] as? String, isDeviceToken(token) else { return .unexpected }
        return .ok(token: token, email: email)
    }

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
