import WebKit

// What the iOS holder runs on (issue #895). The phone is never paired on iOS yet (pairing is a
// later issue), so instructor mode's way in is pairing and the page hears "unpaired". Of the parts
// a switch drops only the web view's storage exists on iOS yet; the others have nothing to drop
// and finish at once, in the order ModePolicy.teardown names them.
final class PhoneDevice: Device {
    private let lock: ScreenLock

    init(lock: ScreenLock) {
        self.lock = lock
    }

    var paired: Bool { false }

    var secureLock: Bool { lock.isSet }
}

enum ModeParts {
    static func teardown() -> [Teardown] {
        ModePolicy.teardown.map { name in
            if name == "webStorage" {
                return Teardown(name: name) { done in
                    let store = WKWebsiteDataStore.default()
                    store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
                        done(nil)
                    }
                }
            }
            return Teardown(name: name) { done in done(nil) }
        }
    }
}
