import Foundation

// What the rider's session reads and writes on the wire (issue #898, ADR 0011 sections 1 and 3):
// the rules of Android's RiderSession.kt companion, in Swift. A frame the page may see, the join's
// answer read strictly, the forms of the session code, the nickname and the rider token, and
// `hello`, built natively so the page never holds the token. Pure: Foundation's JSON types and
// regular expressions only.
enum RiderWire {
    /// The rider-bound messages (schema/live/v1/routing.json, `to` rider): nothing else goes to
    /// the page. A test holds this to routing.json (test/ios-rider.test.ts).
    static let riderTypes: Set<String> = ["welcome", "host_status", "rider_state", "ended"]

    /// Close codes after which the token is no use (backend live_wire_policy.py).
    static let finalCodes: Set<Int> = [4401, 4403, 4409]

    static let maxFrameChars = 64 * 1024
    private static let maxErrorChars = 64
    private static let nicknameMax = 24
    /// The join code carries only the session's identifier (rule 14).
    private static let sessionForm = "[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}"
    private static let tokenForm = "cbp_rdr_[A-Za-z0-9_-]{43}"

    static func sessionFits(_ code: String) -> Bool {
        WholeMatch.matches(code, sessionForm)
    }

    /// Not blank, nothing to trim, at most 24 code points.
    static func nicknameFits(_ n: String) -> Bool {
        let trimmed = n.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed.unicodeScalars.elementsEqual(n.unicodeScalars) && n.unicodeScalars.count <= nicknameMax
    }

    /// `hello`, as the live contract has it (schema/live/v1, hello); nil only if it cannot be written.
    static func hello(_ token: String) -> String? {
        let message: [String: Any] = ["v": 1, "type": "hello", "token": token]
        guard let data = try? JSONSerialization.data(withJSONObject: message, options: [.sortedKeys, .withoutEscapingSlashes]) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// A frame the rider may see: version 1, one of `riderTypes`, and a welcome only as a rider.
    static func riderBound(_ frame: String) -> Bool {
        guard let m = object(frame), let type = m["type"] as? String, versionOne(m["v"]), riderTypes.contains(type) else { return false }
        return type != "welcome" || (m["role"] as? String) == "rider"
    }

    /// The message's type, when the text is a JSON object with one.
    static func type(_ frame: String) -> String? {
        object(frame)?["type"] as? String
    }

    /// The rider token in a join's answer: a 200 whose body is exactly `{riderToken}` of the token's form.
    static func tokenIn(_ status: Int, _ body: Any?) -> String? {
        guard status == 200, let b = body as? [String: Any], b.count == 1,
              let t = b["riderToken"] as? String, WholeMatch.matches(t, tokenForm) else { return nil }
        return t
    }

    /// Only `{error: <word>}` is passed on; any other body is the page's "unexpected".
    static func errorWord(_ body: Any?) -> [String: Any]? {
        guard let m = body as? [String: Any], m.count == 1, let e = m["error"] as? String,
              e.utf16.count <= maxErrorChars, WholeMatch.matches(e, "[a-z_]+") else { return nil }
        return ["error": e]
    }

    private static func object(_ text: String) -> [String: Any]? {
        guard let data = text.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// A JSON 1; a JSON true is not a number here.
    private static func versionOne(_ v: Any?) -> Bool {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return false }
        return n.doubleValue == 1
    }
}
