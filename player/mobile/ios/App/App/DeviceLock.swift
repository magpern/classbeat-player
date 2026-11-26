import Foundation
import LocalAuthentication

// The device owner's authentication (issue #895): LocalAuthentication's deviceOwnerAuthentication,
// which takes Face ID or Touch ID with the passcode behind it, or the passcode alone. A device with
// no passcode cannot evaluate it, so it has no instructor mode. A fresh context every time, so no
// earlier pass is ever reused. The tests fake ScreenLock instead (AppTests/ModeControllerTests.swift).
final class DeviceLock: ScreenLock {
    static let reason = "Confirm your passcode to open instructor mode."

    var isSet: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    func ask(_ done: @escaping (Bool) -> Void) {
        let context = LAContext()
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: Self.reason) { passed, _ in
            // A failed, cancelled or unavailable check is simply not passed.
            DispatchQueue.main.async { done(passed) }
        }
    }
}
