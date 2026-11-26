import Foundation

// The last check before any answer goes over the bridge to the page (issue #895, ADR 0011
// section 5): the Swift twin of Android's AnswerPolicy.kt, tested with the same table
// (AppTests/AnswerPolicyTests.swift). Written out whole, an answer must not contain a secret the
// phone holds, in full or in any part long enough to matter. Pure: Foundation's JSON writer only.
enum AnswerPolicy {
    /// A run of a secret this long is refused anywhere in an answer: past the token's prefix.
    static let minPart = 12

    /// True when `answer` may go: it can be written as JSON and holds no part of any of `secrets`.
    static func mayAnswer(_ answer: Any?, _ secrets: [String]) -> Bool {
        // Wrapped in an array, so a lone value or nil is checked as the writer would write it. The
        // writer stops the app on what it cannot write, so that is asked first.
        let wrapped: [Any] = [answer ?? NSNull()]
        guard JSONSerialization.isValidJSONObject(wrapped),
              let data = try? JSONSerialization.data(withJSONObject: wrapped, options: [.sortedKeys, .withoutEscapingSlashes]),
              let text = String(data: data, encoding: .utf8) else { return false }
        // A secret's characters (letters, digits, `_` and `-`) are never escaped, so the text holds it as is.
        return !secrets.contains { leaks(text, $0) }
    }

    private static func leaks(_ text: String, _ secret: String) -> Bool {
        if secret.isEmpty { return false }
        let chars = Array(secret)
        if chars.count <= minPart { return text.contains(secret) }
        return (0...(chars.count - minPart)).contains { text.contains(String(chars[$0..<($0 + minPart)])) }
    }
}
