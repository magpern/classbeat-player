import UIKit

// The pairing screens' faces (issue #988, docs/design/app-pairing-ios.md over app.md): the two bundled
// fonts the web pages use, as TrueType copies registered through the app's `UIAppFonts` (Info.plist).
// The number face (Big Shoulders Display, 800) draws the title, the code and the step numerals; the
// text face (Atkinson Hyperlegible) draws everything else, bold where the mock-ups say 700. Core Text
// cannot read the pages' .woff2 files, hence the copies. The system's own face is only a fallback for
// a build that lost a font file: the tests fail then.
enum PairingFonts {
    /// The files the app bundles and `UIAppFonts` lists.
    static let files = ["big-shoulders-display-800.ttf", "atkinson-hyperlegible-400.ttf", "atkinson-hyperlegible-700.ttf"]
    static let numberName = "BigShouldersDisplayThin-ExtraBold"
    static let textName = "AtkinsonHyperlegible-Regular"
    static let textBoldName = "AtkinsonHyperlegible-Bold"
    static let names: Set<String> = [numberName, textName, textBoldName]

    static func number(_ size: CGFloat) -> UIFont {
        UIFont(name: numberName, size: size) ?? .boldSystemFont(ofSize: size)
    }

    static func text(_ size: CGFloat, bold: Bool) -> UIFont {
        UIFont(name: bold ? textBoldName : textName, size: size) ?? (bold ? .boldSystemFont(ofSize: size) : .systemFont(ofSize: size))
    }
}
