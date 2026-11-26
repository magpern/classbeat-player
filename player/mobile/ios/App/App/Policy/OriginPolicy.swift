import Foundation

// The backend's address (issue #896, ADR 0016 section 4): the Swift twin of Android's
// OriginPolicy.kt. Fixed in the build: HTTPS, or loopback HTTP in a debug build only. A device
// token is sent only to an address this accepts, and only to the one that issued it. Stricter than
// a URL parser on purpose: only the plain form of an origin passes, so there is one way to write
// each. Pure: Foundation's regular expressions only.
enum OriginPolicy {
    private static let origin = "(https|http)://([a-z0-9-]+(?:\\.[a-z0-9-]+)*|\\[::1\\])(?::([1-9][0-9]{0,4}))?"
    private static let loopback: Set<String> = ["127.0.0.1", "localhost", "[::1]"]
    private static let pagePath = "/[A-Za-z0-9._~/-]{0,150}"
    private static let maxPage = 200

    /// The origin, or nil when it is unset or not an origin this build may call.
    static func parseBackendOrigin(_ raw: String?, allowLoopbackHttp: Bool) -> String? {
        guard let raw = raw else { return nil }
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasSuffix("/") { text.removeLast() }
        guard let re = try? NSRegularExpression(pattern: "\\A" + origin + "\\z") else { return nil }
        let whole = text as NSString
        guard let m = re.firstMatch(in: text, range: NSRange(location: 0, length: whole.length)) else { return nil }
        let scheme = whole.substring(with: m.range(at: 1))
        let host = whole.substring(with: m.range(at: 2))
        let port = m.range(at: 3).location == NSNotFound ? "" : whole.substring(with: m.range(at: 3))
        let secure = scheme == "https" || (allowLoopbackHttp && loopback.contains(host))
        if !secure { return nil }
        if !port.isEmpty {
            // The default port is written without it, as a browser writes the origin.
            guard let n = Int(port), n <= 65535 else { return nil }
            if (scheme == "https" && n == 443) || (scheme == "http" && n == 80) { return nil }
        }
        return text
    }

    /// The pairing page the app may open in Safari: on the backend's own origin, with no query,
    /// fragment or user name (the code is typed there, never carried in the address). Nil otherwise.
    static func pairingPageOn(_ origin: String, _ uri: Any?) -> String? {
        guard let uri = uri as? String, uri.utf16.count <= maxPage, uri.hasPrefix(origin + "/") else { return nil }
        let path = String(uri.dropFirst(origin.count))
        if !WholeMatch.matches(path, pagePath) || path.contains("//") { return nil }
        if path.split(separator: "/", omittingEmptySubsequences: false).contains(where: { $0 == "." || $0 == ".." }) {
            return nil
        }
        return uri
    }
}
