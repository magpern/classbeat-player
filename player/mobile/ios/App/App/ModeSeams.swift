// What ModeController reaches through (issues #895 and #925): the screen lock, the native screens,
// the web view and the page's call. Pure: no import, so the tests fake every one of them
// (AppTests/ModeControllerTests.swift).

/// The device owner's authentication (LocalAuthentication on a device, a fake in the tests).
protocol ScreenLock: AnyObject {
    /// The device has a passcode. Read again at every decision.
    var isSet: Bool { get }

    /// Asks the device owner's authentication, afresh every time; `done` hears whether it passed.
    func ask(_ done: @escaping (Bool) -> Void)
}

/// The native screens over the page.
protocol ModeScreens: AnyObject {
    /// "A passcode is needed": instructor mode cannot open without one.
    func noLock(stay: @escaping () -> Void)

    /// "Switch to rider mode?"
    func riderQuestion(stay: @escaping () -> Void, switch: @escaping () -> Void)

    /// "Unpair this phone?": only "Unpair" deletes anything (issue #925).
    func unpairQuestion(stay: @escaping () -> Void, unpair: @escaping () -> Void)

    /// The switching screen while a switch runs.
    func switching(rider: Bool)

    /// Takes down whatever native screen shows.
    func hide()
}

/// Loads a bundled page in the web view's main frame.
protocol PageLoader: AnyObject {
    func load(_ path: String)
}

/// A call from the page, answered once.
protocol PageCall: AnyObject {
    func answer(_ data: [String: Any])
    func refuse()
}
