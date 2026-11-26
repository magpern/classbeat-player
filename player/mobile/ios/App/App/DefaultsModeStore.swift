import Foundation

// Where the mode is kept between launches (issue #895): the app's own UserDefaults, which the web
// view cannot read or write (its storage is WebKit's, apart from the app's defaults), and which no
// intent touches. Every write is read back, and a value that did not stick throws, so the holder
// stops rather than open a mode it could not record.
final class DefaultsModeStore: ModeStore {
    static let modeKey = "classbeat.mode"
    static let wipeKey = "classbeat.modeWipePending"

    struct NotWritten: Error {}

    private let defaults: UserDefaults

    init(_ defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func read() -> String? {
        defaults.string(forKey: Self.modeKey)
    }

    func write(_ value: String) throws {
        defaults.set(value, forKey: Self.modeKey)
        guard defaults.string(forKey: Self.modeKey) == value else { throw NotWritten() }
    }

    func wipePending() -> Bool {
        defaults.bool(forKey: Self.wipeKey)
    }

    func setWipePending(_ pending: Bool) throws {
        defaults.set(pending, forKey: Self.wipeKey)
        guard defaults.bool(forKey: Self.wipeKey) == pending else { throw NotWritten() }
    }
}
