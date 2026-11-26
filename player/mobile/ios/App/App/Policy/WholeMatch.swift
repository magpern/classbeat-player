import Foundation

// A whole-text regular expression match, as Kotlin's `Regex.matches`, for the pairing's pure rules
// (issue #896). `\A` and `\z` anchor at the very start and end: ICU's `$` would also let a
// trailing newline through. Pure: Foundation's regular expressions only.
enum WholeMatch {
    static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: "\\A(?:" + pattern + ")\\z", options: .regularExpression) != nil
    }
}
