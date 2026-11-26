import Foundation

// Where the web view may go (issue #894): the Swift twin of Android's NavigationPolicy.kt, tested
// with the same table (AppTests/NavigationPolicyTests.swift). Pure: Foundation's URL parsing only.
//
// The page is the bundle the app carries, served by Capacitor at capacitor://localhost/. The web
// view never leaves it: a link the user taps to another https site opens in Safari, and everything
// else (another scheme, a frame, a load without a tap, Capacitor's /_capacitor_ paths that serve
// device files or proxy remote content) is refused.
//
// Capacitor's scheme handler matches its special paths on the *decoded* path (URL.path), so the
// decision is made on the decoded path too. A malformed escape or invalid UTF-8, an escape that
// decodes to another escape, a dot or empty segment, a backslash or a control character is refused,
// and no segment may start with "_capacitor_" in any letter case.
enum NavigationPolicy {
    static let scheme = "capacitor"
    static let host = "localhost"
    static let appOrigin = "capacitor://localhost"

    /// Capacitor's special paths (local files, its HTTP proxy): never served.
    static let capacitorPrefix = "/_capacitor_"
    private static let capacitorSegment = "_capacitor_"

    enum Decision: Equatable {
        case load, browser, refuse
    }

    private static func hexValue(_ byte: UInt8) -> UInt8? {
        switch byte {
        case 0x30...0x39: return byte - 0x30
        case 0x41...0x46: return byte - 0x41 + 10
        case 0x61...0x66: return byte - 0x61 + 10
        default: return nil
        }
    }

    /// Strict percent-decoding as UTF-8; nil for a bad escape or invalid UTF-8.
    static func decodePath(_ raw: String) -> String? {
        let chars = Array(raw.utf8)
        var bytes: [UInt8] = []
        var i = 0
        while i < chars.count {
            if chars[i] == 0x25 {
                guard i + 2 < chars.count, let hi = hexValue(chars[i + 1]), let lo = hexValue(chars[i + 2]) else {
                    return nil
                }
                bytes.append(hi * 16 + lo)
                i += 3
            } else {
                bytes.append(chars[i])
                i += 1
            }
        }
        // Decoding replaces invalid UTF-8 (overlong forms, lone bytes) with U+FFFD, so a text that
        // does not encode back to the same bytes was not valid UTF-8.
        let text = String(decoding: bytes, as: UTF8.self)
        return Array(text.utf8) == bytes ? text : nil
    }

    private static func isControl(_ scalar: Unicode.Scalar) -> Bool {
        scalar.value < 0x20 || (scalar.value >= 0x7F && scalar.value <= 0x9F)
    }

    /// True for the raw path of a bundle file, judged on its decoded form.
    private static func isBundlePath(_ raw: String) -> Bool {
        if raw.isEmpty { return true }
        guard let path = decodePath(raw), path.hasPrefix("/") else { return false }
        if path.unicodeScalars.contains(where: { $0 == "%" || $0 == "\\" || isControl($0) }) { return false }
        let segments = path.dropFirst().split(separator: "/", omittingEmptySubsequences: false)
        for (index, segment) in segments.enumerated() {
            if segment.isEmpty && index != segments.count - 1 { return false }
            if segment == "." || segment == ".." { return false }
            if segment.lowercased().hasPrefix(capacitorSegment) { return false }
        }
        return true
    }

    private static func hasUser(_ url: URLComponents) -> Bool {
        url.percentEncodedUser != nil || url.percentEncodedPassword != nil
    }

    /// True for a URL of the bundle: capacitor://localhost, no port or user, not a Capacitor path.
    static func isBundled(_ url: String) -> Bool {
        guard let parts = URLComponents(string: url) else { return false }
        guard parts.scheme == scheme, parts.percentEncodedHost == host else { return false }
        if parts.port != nil || hasUser(parts) { return false }
        return isBundlePath(parts.percentEncodedPath)
    }

    /// A request the web view makes of the app's scheme: only the bundle's own files are served.
    static func serves(_ url: String) -> Bool {
        isBundled(url)
    }

    /// A navigation: the bundle loads in place; a tapped https link to a site opens in Safari.
    static func navigate(_ url: String, mainFrame: Bool, userGesture: Bool) -> Decision {
        if isBundled(url) { return mainFrame ? .load : .refuse }
        if !mainFrame || !userGesture { return .refuse }
        guard let parts = URLComponents(string: url), parts.scheme == "https" else { return .refuse }
        guard let site = parts.percentEncodedHost, !site.isEmpty else { return .refuse }
        if site.lowercased() == host || hasUser(parts) { return .refuse }
        return .browser
    }
}
