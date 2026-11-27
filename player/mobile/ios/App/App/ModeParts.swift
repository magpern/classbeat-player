import WebKit

// What the iOS holder runs on (issues #895 and #896). The phone is paired while the pairing holds
// a token (PairingService.paired); with no backend in the build yet it never is, so instructor
// mode's way in is pairing and the page hears "unpaired". Of the parts a switch drops the rider's
// session (issue #898) and the web view's storage exist on iOS yet; the others have nothing to drop
// and finish at once, in the order ModePolicy.teardown names them.
final class PhoneDevice: Device {
    private let lock: ScreenLock
    private let isPaired: () -> Bool

    init(lock: ScreenLock, paired: @escaping () -> Bool) {
        self.lock = lock
        self.isPaired = paired
    }

    var paired: Bool { isPaired() }

    var secureLock: Bool { lock.isSet }
}

enum ModeParts {
    static func teardown(rider: RiderSession) -> [Teardown] {
        ModePolicy.teardown.map { name in
            if name == "riderSession" {
                return Teardown(name: name) { done in
                    rider.drop()
                    done(nil)
                }
            }
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
